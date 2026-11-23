import {
  VaultAlreadyExistsError,
  VaultConflictError,
} from "./errors.ts";
import type {
  EncryptedVaultEnvelope,
  VaultStore,
} from "./types.ts";

const DATABASE_NAME = "idencified";
const DATABASE_VERSION = 1;
const OBJECT_STORE = "vaults";
const PRIMARY_KEY = "primary";

export class IndexedDbVaultStore implements VaultStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private openDatabase(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;

    this.databasePromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error("IndexedDB is unavailable."));
        return;
      }

      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(OBJECT_STORE)) {
          database.createObjectStore(OBJECT_STORE, { keyPath: "id" });
        }
      };

      request.onsuccess = () => {
        const database = request.result;

        database.onversionchange = () => {
          database.close();
          this.databasePromise = null;
        };

        resolve(database);
      };

      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error ?? new Error("Could not open the vault database."));
      };

      request.onblocked = () => {
        this.databasePromise = null;
        reject(new Error("The vault database upgrade is blocked by another window."));
      };
    });

    return this.databasePromise;
  }

  async read(): Promise<unknown | null> {
    const database = await this.openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, "readonly");
      const request = transaction.objectStore(OBJECT_STORE).get(PRIMARY_KEY);

      request.onsuccess = () => {
        resolve(request.result ?? null);
      };

      request.onerror = () => {
        reject(request.error ?? new Error("Could not read the vault."));
      };

      transaction.onabort = () => {
        reject(transaction.error ?? new Error("Vault read transaction aborted."));
      };
    });
  }

  async create(envelope: EncryptedVaultEnvelope): Promise<void> {
    const database = await this.openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, "readwrite");
      const request = transaction.objectStore(OBJECT_STORE).add(envelope);

      request.onerror = () => {
        if (request.error?.name === "ConstraintError") {
          transaction.abort();
          return;
        }

        transaction.abort();
      };

      transaction.oncomplete = () => resolve();

      transaction.onabort = () => {
        if (request.error?.name === "ConstraintError") {
          reject(new VaultAlreadyExistsError());
        } else {
          reject(transaction.error ?? request.error ?? new Error("Could not create the vault."));
        }
      };

      transaction.onerror = () => {
        // onabort handles the final rejection.
      };
    });
  }

  async compareAndSwap(
    expectedRevision: number,
    expectedSalt: string,
    nextEnvelope: EncryptedVaultEnvelope,
  ): Promise<void> {
    const database = await this.openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, "readwrite");
      const objectStore = transaction.objectStore(OBJECT_STORE);
      const request = objectStore.get(PRIMARY_KEY);

      let conflict = false;

      request.onsuccess = () => {
        const current: unknown = request.result;

        if (
          typeof current !== "object" ||
          current === null ||
          !("revision" in current) ||
          !("salt" in current) ||
          current.revision !== expectedRevision ||
          current.salt !== expectedSalt
        ) {
          conflict = true;
          transaction.abort();
          return;
        }

        if (
          nextEnvelope.id !== PRIMARY_KEY ||
          nextEnvelope.revision !== expectedRevision + 1 ||
          nextEnvelope.salt !== expectedSalt
        ) {
          conflict = true;
          transaction.abort();
          return;
        }

        objectStore.put(nextEnvelope);
      };

      request.onerror = () => {
        transaction.abort();
      };

      transaction.oncomplete = () => resolve();

      transaction.onabort = () => {
        if (conflict) {
          reject(new VaultConflictError());
        } else {
          reject(transaction.error ?? request.error ?? new Error("Vault update failed."));
        }
      };

      transaction.onerror = () => {
        // onabort handles the final rejection.
      };
    });
  }

  async clear(): Promise<void> {
    const database = await this.openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE, "readwrite");
      transaction.objectStore(OBJECT_STORE).delete(PRIMARY_KEY);

      transaction.oncomplete = () => resolve();

      transaction.onabort = () => {
        reject(transaction.error ?? new Error("Could not clear the vault."));
      };

      transaction.onerror = () => {
        // onabort handles the final rejection.
      };
    });
  }
}
