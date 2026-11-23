import { createEncryptedEnvelope, decryptEnvelope, encryptPayloadWithKey, validateEnvelope } from "./crypto.ts";
import { VaultAlreadyExistsError, VaultConflictError, VaultNotFoundError } from "./errors.ts";
import type { VaultPayload, VaultSession, VaultStore } from "./types.ts";
import { validateVaultPayload } from "./validation.ts";

export async function createVault(store: VaultStore, passphrase: string): Promise<VaultSession> {
  if (await store.read()) {
    throw new VaultAlreadyExistsError();
  }

  const payload: VaultPayload = { schemaVersion: 1, identities: [] };
  const { envelope, key } = await createEncryptedEnvelope(passphrase, payload, 1);
  await store.create(envelope);

  return { key, salt: envelope.salt, revision: envelope.revision, payload };
}

export async function unlockVault(store: VaultStore, passphrase: string): Promise<VaultSession> {
  const saved = await store.read();
  if (!saved) {
    throw new VaultNotFoundError();
  }
  const result = await decryptEnvelope(passphrase, saved);
  return {
    key: result.key,
    salt: result.envelope.salt,
    revision: result.envelope.revision,
    payload: result.payload,
  };
}

export async function saveVault(store: VaultStore, session: VaultSession): Promise<VaultSession> {
  const rawCurrent = await store.read();
  if (!rawCurrent) {
    throw new VaultNotFoundError();
  }
  const current = validateEnvelope(rawCurrent);
  if (current.revision !== session.revision || current.salt !== session.salt) {
    throw new VaultConflictError();
  }

  const payload = validateVaultPayload(session.payload);
  const next = await encryptPayloadWithKey(session.key, current.salt, payload, current.revision + 1);
  await store.compareAndSwap(current.revision, current.salt, next);

  return {
    key: session.key,
    salt: next.salt,
    revision: next.revision,
    payload,
  };
}

export async function destroyVault(store: VaultStore): Promise<void> {
  await store.clear();
}
