export class ValidationError extends Error {
  constructor(message = "The supplied data is invalid.") {
    super(message);
    this.name = "ValidationError";
  }
}

export class VaultCorruptError extends Error {
  constructor() {
    super("The encrypted vault is damaged or has an unsupported format.");
    this.name = "VaultCorruptError";
  }
}

export class VaultUnlockError extends Error {
  constructor() {
    super("The vault could not be unlocked.");
    this.name = "VaultUnlockError";
  }
}

export class VaultAlreadyExistsError extends Error {
  constructor() {
    super("A vault already exists.");
    this.name = "VaultAlreadyExistsError";
  }
}

export class VaultNotFoundError extends Error {
  constructor() {
    super("No vault exists.");
    this.name = "VaultNotFoundError";
  }
}

export class VaultConflictError extends Error {
  constructor() {
    super("The vault changed during this operation. Unlock it again.");
    this.name = "VaultConflictError";
  }
}
