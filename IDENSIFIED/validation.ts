import { ValidationError, VaultCorruptError } from "./errors.ts";
import type { IdentityRecord, VaultPayload } from "./types.ts";

const MAX_IDENTITIES = 250;

const IDENTITY_KEYS = [
  "id",
  "origin",
  "label",
  "emailAlias",
  "usernameAlias",
  "phoneAlias",
  "addressAlias",
  "createdAt",
  "updatedAt",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);

  return (
    actual.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function validateString(
  value: unknown,
  field: string,
  maxLength: number,
  required = false,
): string {
  if (typeof value !== "string") {
    throw new ValidationError(`Invalid ${field}.`);
  }

  const cleaned = value.trim();

  if (
    cleaned.length > maxLength ||
    (required && cleaned.length === 0) ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(cleaned)
  ) {
    throw new ValidationError(`Invalid ${field}.`);
  }

  return cleaned;
}

function validateOrigin(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) {
    throw new ValidationError("Invalid website origin.");
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new ValidationError("Invalid website origin.");
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new ValidationError("Enter only an HTTPS website origin.");
  }

  return url.origin;
}

function validateTimestamp(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new ValidationError(`Invalid ${field}.`);
  }

  return value;
}

function validateAliasValues(
  emailAlias: string,
  usernameAlias: string,
  phoneAlias: string,
  addressAlias: string,
): void {
  if (
    emailAlias !== "" &&
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(emailAlias)
  ) {
    throw new ValidationError("Invalid email alias.");
  }

  if (!emailAlias && !usernameAlias && !phoneAlias && !addressAlias) {
    throw new ValidationError("Add at least one masked detail.");
  }
}

function validateIdentity(value: unknown): IdentityRecord {
  if (!isPlainObject(value) || !hasExactKeys(value, IDENTITY_KEYS)) {
    throw new ValidationError("Invalid identity record structure.");
  }

  const id = validateString(value.id, "identity ID", 36, true);

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new ValidationError("Invalid identity ID.");
  }

  const origin = validateOrigin(value.origin);
  const label = validateString(value.label, "identity label", 100, true);
  const emailAlias = validateString(value.emailAlias, "email alias", 254);
  const usernameAlias = validateString(value.usernameAlias, "username alias", 100);
  const phoneAlias = validateString(value.phoneAlias, "phone alias", 40);
  const addressAlias = validateString(value.addressAlias, "address alias", 500);

  validateAliasValues(emailAlias, usernameAlias, phoneAlias, addressAlias);

  const createdAt = validateTimestamp(value.createdAt, "creation timestamp");
  const updatedAt = validateTimestamp(value.updatedAt, "update timestamp");

  if (updatedAt < createdAt) {
    throw new ValidationError("Identity update timestamp predates creation.");
  }

  return {
    id,
    origin,
    label,
    emailAlias,
    usernameAlias,
    phoneAlias,
    addressAlias,
    createdAt,
    updatedAt,
  };
}

export function makeIdentityRecord(input: {
  origin: string;
  label: string;
  emailAlias: string;
  usernameAlias: string;
  phoneAlias: string;
  addressAlias: string;
}): IdentityRecord {
  if (!isPlainObject(input)) {
    throw new ValidationError("Invalid identity input.");
  }

  const origin = validateOrigin(input.origin);
  const label = validateString(input.label, "identity label", 100, true);
  const emailAlias = validateString(input.emailAlias, "email alias", 254);
  const usernameAlias = validateString(input.usernameAlias, "username alias", 100);
  const phoneAlias = validateString(input.phoneAlias, "phone alias", 40);
  const addressAlias = validateString(input.addressAlias, "address alias", 500);

  validateAliasValues(emailAlias, usernameAlias, phoneAlias, addressAlias);

  const now = Date.now();

  return {
    id: crypto.randomUUID(),
    origin,
    label,
    emailAlias,
    usernameAlias,
    phoneAlias,
    addressAlias,
    createdAt: now,
    updatedAt: now,
  };
}

export function validateVaultPayload(value: unknown): VaultPayload {
  try {
    if (
      !isPlainObject(value) ||
      !hasExactKeys(value, ["schemaVersion", "identities"]) ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.identities) ||
      value.identities.length > MAX_IDENTITIES
    ) {
      throw new ValidationError("Invalid vault payload.");
    }

    const identities = value.identities.map(validateIdentity);
    const ids = new Set<string>();
    const origins = new Set<string>();

    for (const identity of identities) {
      if (ids.has(identity.id) || origins.has(identity.origin)) {
        throw new ValidationError("Duplicate identity ID or website origin.");
      }

      ids.add(identity.id);
      origins.add(identity.origin);
    }

    return {
      schemaVersion: 1,
      identities,
    };
  } catch {
    throw new VaultCorruptError();
  }
}
