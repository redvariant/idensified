import { argon2id } from "hash-wasm";
import { VaultCorruptError, VaultUnlockError, ValidationError } from "./errors.ts";
import type { EncryptedVaultEnvelope, KdfMetadata, VaultPayload } from "./types.ts";
import { validateVaultPayload } from "./validation.ts";

export const KDF_METADATA: KdfMetadata = Object.freeze({
  algorithm: "argon2id",
  version: 19,
  memoryKiB: 19_456,
  iterations: 2,
  parallelism: 1,
  keyBytes: 32,
});

const FORMAT_VERSION = 1 as const;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const MAX_PASSPHRASE_BYTES = 1_024;
const MAX_CIPHERTEXT_BYTES = 1_500_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface CryptoProvider {
  readonly subtle: SubtleCrypto;
  getRandomValues<T extends Exclude<BufferSource, ArrayBuffer>>(array: T): T;
}

function assertCrypto(provider: CryptoProvider): void {
  if (!provider?.subtle || typeof provider.getRandomValues !== "function") {
    throw new Error("Web Crypto is unavailable in this browser context.");
  }
}

function aadFor(revision: number, updatedAt: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    `IDENCIFIED|VAULT_FORMAT=1|REVISION=${revision}|UPDATED_AT=${updatedAt}|ARGON2ID=v=19,m=19456,t=2,p=1|AES-256-GCM`,
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function fromBase64(value: unknown, expectedLength?: number, maximumLength = MAX_CIPHERTEXT_BYTES): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maximumLength * 4 / 3) + 4) {
    throw new VaultCorruptError();
  }

  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new VaultCorruptError();
  }

  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (
    bytes.length > maximumLength ||
    (expectedLength !== undefined && bytes.length !== expectedLength) ||
    toBase64(bytes) !== value
  ) {
    bytes.fill(0);
    throw new VaultCorruptError();
  }
  return bytes;
}

function normalizePassphrase(passphrase: string): string {
  if (typeof passphrase !== "string") {
    throw new ValidationError("Enter your vault passphrase.");
  }
  const normalized = passphrase.normalize("NFKC");
  const byteLength = encoder.encode(normalized).length;
  const characterLength = [...normalized].length;
  if (characterLength < 16 || byteLength > MAX_PASSPHRASE_BYTES) {
    throw new ValidationError("Use a passphrase of at least 16 characters and no more than 1,024 UTF-8 bytes.");
  }
  return normalized;
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, provider: CryptoProvider): Promise<CryptoKey> {
  const normalized = normalizePassphrase(passphrase);
  const derived = await argon2id({
    password: normalized,
    salt,
    parallelism: KDF_METADATA.parallelism,
    iterations: KDF_METADATA.iterations,
    memorySize: KDF_METADATA.memoryKiB,
    hashLength: KDF_METADATA.keyBytes,
    outputType: "binary",
  });
  if (!(derived instanceof Uint8Array) || derived.byteLength !== KDF_METADATA.keyBytes) {
    throw new Error("Argon2id returned an invalid key length or encoding.");
  }
  const rawKey = new Uint8Array(new ArrayBuffer(derived.byteLength));
  rawKey.set(derived);

  try {
    return await provider.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    rawKey.fill(0);
    derived.fill(0);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function validateEnvelope(value: unknown): EncryptedVaultEnvelope {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "formatVersion", "revision", "updatedAt", "salt", "kdf", "cipher"])) {
    throw new VaultCorruptError();
  }
  if (
    value.id !== "primary" || value.formatVersion !== FORMAT_VERSION ||
    typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
    typeof value.updatedAt !== "number" || !Number.isSafeInteger(value.updatedAt) || value.updatedAt <= 0
  ) {
    throw new VaultCorruptError();
  }

  if (!isRecord(value.kdf) || !hasExactKeys(value.kdf, ["algorithm", "version", "memoryKiB", "iterations", "parallelism", "keyBytes"])) {
    throw new VaultCorruptError();
  }
  if (
    value.kdf.algorithm !== KDF_METADATA.algorithm || value.kdf.version !== KDF_METADATA.version ||
    value.kdf.memoryKiB !== KDF_METADATA.memoryKiB || value.kdf.iterations !== KDF_METADATA.iterations ||
    value.kdf.parallelism !== KDF_METADATA.parallelism || value.kdf.keyBytes !== KDF_METADATA.keyBytes
  ) {
    throw new VaultCorruptError();
  }

  if (!isRecord(value.cipher) || !hasExactKeys(value.cipher, ["algorithm", "iv", "ciphertext"]) || value.cipher.algorithm !== "AES-256-GCM") {
    throw new VaultCorruptError();
  }

  const saltBytes = fromBase64(value.salt, SALT_BYTES, SALT_BYTES);
  const ivBytes = fromBase64(value.cipher.iv, IV_BYTES, IV_BYTES);
  const ciphertextBytes = fromBase64(value.cipher.ciphertext, undefined, MAX_CIPHERTEXT_BYTES);
  const ciphertextValid = ciphertextBytes.length >= 16;
  saltBytes.fill(0);
  ivBytes.fill(0);
  ciphertextBytes.fill(0);
  if (!ciphertextValid) throw new VaultCorruptError();

  // Reconstruct a clean object instead of returning the untrusted IndexedDB object.
  return {
    id: "primary",
    formatVersion: 1,
    revision: value.revision,
    updatedAt: value.updatedAt,
    salt: value.salt as string,
    kdf: KDF_METADATA,
    cipher: {
      algorithm: "AES-256-GCM",
      iv: value.cipher.iv as string,
      ciphertext: value.cipher.ciphertext as string,
    },
  };
}

export async function createEncryptedEnvelope(
  passphrase: string,
  payload: VaultPayload,
  revision: number,
  provider: CryptoProvider = crypto,
): Promise<{ envelope: EncryptedVaultEnvelope; key: CryptoKey }> {
  assertCrypto(provider);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new ValidationError("Invalid vault revision.");
  }

  const validPayload = validateVaultPayload(payload);
  const plaintext = encoder.encode(JSON.stringify(validPayload));
  if (plaintext.length > 1_000_000) {
    plaintext.fill(0);
    throw new ValidationError("The vault is too large to save.");
  }

  const salt = new Uint8Array(new ArrayBuffer(SALT_BYTES));
  const iv = new Uint8Array(new ArrayBuffer(IV_BYTES));
  let aad: Uint8Array<ArrayBuffer> | undefined;
  try {
    provider.getRandomValues(salt);
    provider.getRandomValues(iv);
    const key = await deriveAesKey(passphrase, salt, provider);
    const updatedAt = Date.now();
    aad = aadFor(revision, updatedAt);
    const encrypted = await provider.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
      key,
      plaintext,
    );

    const envelope: EncryptedVaultEnvelope = {
      id: "primary",
      formatVersion: FORMAT_VERSION,
      revision,
      updatedAt,
      salt: toBase64(salt),
      kdf: KDF_METADATA,
      cipher: {
        algorithm: "AES-256-GCM",
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(encrypted)),
      },
    };

    return { envelope, key };
  } finally {
    plaintext.fill(0);
    salt.fill(0);
    iv.fill(0);
    aad?.fill(0);
  }
}

export async function encryptPayloadWithKey(
  key: CryptoKey,
  saltBase64: string,
  payload: VaultPayload,
  revision: number,
  provider: CryptoProvider = crypto,
): Promise<EncryptedVaultEnvelope> {
  assertCrypto(provider);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new ValidationError("Invalid vault revision.");

  const salt = fromBase64(saltBase64, SALT_BYTES, SALT_BYTES);
  let plaintext: Uint8Array<ArrayBuffer> | undefined;
  const iv = new Uint8Array(new ArrayBuffer(IV_BYTES));
  let aad: Uint8Array<ArrayBuffer> | undefined;
  try {
    const validPayload = validateVaultPayload(payload);
    plaintext = encoder.encode(JSON.stringify(validPayload));
    if (plaintext.length > 1_000_000) {
      throw new ValidationError("The vault is too large to save.");
    }
    provider.getRandomValues(iv);
    const updatedAt = Date.now();
    aad = aadFor(revision, updatedAt);
    const encrypted = await provider.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
      key,
      plaintext,
    );

    return {
      id: "primary",
      formatVersion: FORMAT_VERSION,
      revision,
      updatedAt,
      salt: toBase64(salt),
      kdf: KDF_METADATA,
      cipher: {
        algorithm: "AES-256-GCM",
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(encrypted)),
      },
    };
  } finally {
    salt.fill(0);
    plaintext?.fill(0);
    iv.fill(0);
    aad?.fill(0);
  }
}

export async function decryptEnvelope(
  passphrase: string,
  untrustedEnvelope: unknown,
  provider: CryptoProvider = crypto,
): Promise<{ payload: VaultPayload; key: CryptoKey; envelope: EncryptedVaultEnvelope }> {
  assertCrypto(provider);
  const envelope = validateEnvelope(untrustedEnvelope);
  const salt = fromBase64(envelope.salt, SALT_BYTES, SALT_BYTES);
  const iv = fromBase64(envelope.cipher.iv, IV_BYTES, IV_BYTES);
  const ciphertext = fromBase64(envelope.cipher.ciphertext, undefined, MAX_CIPHERTEXT_BYTES);
  const aad = aadFor(envelope.revision, envelope.updatedAt);

  let plaintext: Uint8Array<ArrayBuffer> | undefined;
  try {
    const key = await deriveAesKey(passphrase, salt, provider);
    let decrypted: ArrayBuffer;
    try {
      decrypted = await provider.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
        key,
        ciphertext,
      );
    } catch {
      // Do not distinguish a wrong passphrase from modified ciphertext or metadata.
      throw new VaultUnlockError();
    }
    plaintext = new Uint8Array(decrypted);

    let parsed: unknown;
    try {
      parsed = JSON.parse(decoder.decode(plaintext));
    } catch {
      throw new VaultCorruptError();
    }

    return { payload: validateVaultPayload(parsed), key, envelope };
  } finally {
    salt.fill(0);
    iv.fill(0);
    ciphertext.fill(0);
    aad.fill(0);
    plaintext?.fill(0);
  }
}
