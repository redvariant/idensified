export interface KdfMetadata {
  readonly algorithm: "argon2id";
  readonly version: 19;
  readonly memoryKiB: number;
  readonly iterations: number;
  readonly parallelism: number;
  readonly keyBytes: 32;
}

export interface IdentityRecord {
  id: string;
  origin: string;
  label: string;
  emailAlias: string;
  usernameAlias: string;
  phoneAlias: string;
  addressAlias: string;
  createdAt: number;
  updatedAt: number;
}

export interface VaultPayload {
  schemaVersion: 1;
  identities: IdentityRecord[];
}

export interface EncryptedVaultEnvelope {
  id: "primary";
  formatVersion: 1;
  revision: number;
  updatedAt: number;
  salt: string;
  kdf: KdfMetadata;
  cipher: {
    algorithm: "AES-256-GCM";
    iv: string;
    ciphertext: string;
  };
}

export interface VaultSession {
  key: CryptoKey;
  salt: string;
  revision: number;
  payload: VaultPayload;
}

export interface VaultStore {
  read(): Promise<unknown | null>;
  create(envelope: EncryptedVaultEnvelope): Promise<void>;
  compareAndSwap(
    expectedRevision: number,
    expectedSalt: string,
    nextEnvelope: EncryptedVaultEnvelope,
  ): Promise<void>;
  clear(): Promise<void>;
}
