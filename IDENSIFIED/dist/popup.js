(() => {
  // errors.ts
  var ValidationError = class extends Error {
    constructor(message = "The supplied data is invalid.") {
      super(message);
      this.name = "ValidationError";
    }
  };
  var VaultCorruptError = class extends Error {
    constructor() {
      super("The encrypted vault is damaged or has an unsupported format.");
      this.name = "VaultCorruptError";
    }
  };
  var VaultUnlockError = class extends Error {
    constructor() {
      super("The vault could not be unlocked.");
      this.name = "VaultUnlockError";
    }
  };
  var VaultAlreadyExistsError = class extends Error {
    constructor() {
      super("A vault already exists.");
      this.name = "VaultAlreadyExistsError";
    }
  };
  var VaultNotFoundError = class extends Error {
    constructor() {
      super("No vault exists.");
      this.name = "VaultNotFoundError";
    }
  };
  var VaultConflictError = class extends Error {
    constructor() {
      super("The vault changed during this operation. Unlock it again.");
      this.name = "VaultConflictError";
    }
  };

  // idb-store.ts
  var DATABASE_NAME = "idencified";
  var DATABASE_VERSION = 1;
  var OBJECT_STORE = "vaults";
  var PRIMARY_KEY = "primary";
  var IndexedDbVaultStore = class {
    databasePromise = null;
    openDatabase() {
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
    async read() {
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
    async create(envelope) {
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
        };
      });
    }
    async compareAndSwap(expectedRevision, expectedSalt, nextEnvelope) {
      const database = await this.openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(OBJECT_STORE, "readwrite");
        const objectStore = transaction.objectStore(OBJECT_STORE);
        const request = objectStore.get(PRIMARY_KEY);
        let conflict = false;
        request.onsuccess = () => {
          const current = request.result;
          if (typeof current !== "object" || current === null || !("revision" in current) || !("salt" in current) || current.revision !== expectedRevision || current.salt !== expectedSalt) {
            conflict = true;
            transaction.abort();
            return;
          }
          if (nextEnvelope.id !== PRIMARY_KEY || nextEnvelope.revision !== expectedRevision + 1 || nextEnvelope.salt !== expectedSalt) {
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
        };
      });
    }
    async clear() {
      const database = await this.openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(OBJECT_STORE, "readwrite");
        transaction.objectStore(OBJECT_STORE).delete(PRIMARY_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => {
          reject(transaction.error ?? new Error("Could not clear the vault."));
        };
        transaction.onerror = () => {
        };
      });
    }
  };

  // validation.ts
  var MAX_IDENTITIES = 250;
  var IDENTITY_KEYS = [
    "id",
    "origin",
    "label",
    "emailAlias",
    "usernameAlias",
    "phoneAlias",
    "addressAlias",
    "createdAt",
    "updatedAt"
  ];
  function isPlainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
  function hasExactKeys(value, expected) {
    const actual = Object.keys(value);
    return actual.length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
  }
  function validateString(value, field, maxLength, required = false) {
    if (typeof value !== "string") {
      throw new ValidationError(`Invalid ${field}.`);
    }
    const cleaned = value.trim();
    if (cleaned.length > maxLength || required && cleaned.length === 0 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(cleaned)) {
      throw new ValidationError(`Invalid ${field}.`);
    }
    return cleaned;
  }
  function validateOrigin(value) {
    if (typeof value !== "string" || value.length > 2048) {
      throw new ValidationError("Invalid website origin.");
    }
    let url;
    try {
      url = new URL(value.trim());
    } catch {
      throw new ValidationError("Invalid website origin.");
    }
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
      throw new ValidationError("Enter only an HTTPS website origin.");
    }
    return url.origin;
  }
  function validateTimestamp(value, field) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      throw new ValidationError(`Invalid ${field}.`);
    }
    return value;
  }
  function validateAliasValues(emailAlias, usernameAlias, phoneAlias, addressAlias) {
    if (emailAlias !== "" && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(emailAlias)) {
      throw new ValidationError("Invalid email alias.");
    }
    if (!emailAlias && !usernameAlias && !phoneAlias && !addressAlias) {
      throw new ValidationError("Add at least one masked detail.");
    }
  }
  function validateIdentity(value) {
    if (!isPlainObject(value) || !hasExactKeys(value, IDENTITY_KEYS)) {
      throw new ValidationError("Invalid identity record structure.");
    }
    const id = validateString(value.id, "identity ID", 36, true);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
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
      updatedAt
    };
  }
  function makeIdentityRecord(input) {
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
      updatedAt: now
    };
  }
  function validateVaultPayload(value) {
    try {
      if (!isPlainObject(value) || !hasExactKeys(value, ["schemaVersion", "identities"]) || value.schemaVersion !== 1 || !Array.isArray(value.identities) || value.identities.length > MAX_IDENTITIES) {
        throw new ValidationError("Invalid vault payload.");
      }
      const identities = value.identities.map(validateIdentity);
      const ids = /* @__PURE__ */ new Set();
      const origins = /* @__PURE__ */ new Set();
      for (const identity of identities) {
        if (ids.has(identity.id) || origins.has(identity.origin)) {
          throw new ValidationError("Duplicate identity ID or website origin.");
        }
        ids.add(identity.id);
        origins.add(identity.origin);
      }
      return {
        schemaVersion: 1,
        identities
      };
    } catch {
      throw new VaultCorruptError();
    }
  }

  // node_modules/hash-wasm/dist/index.esm.js
  function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : new P(function(resolve) {
        resolve(value);
      });
    }
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  }
  var Mutex = class {
    constructor() {
      this.mutex = Promise.resolve();
    }
    lock() {
      let begin = () => {
      };
      this.mutex = this.mutex.then(() => new Promise(begin));
      return new Promise((res) => {
        begin = res;
      });
    }
    dispatch(fn) {
      return __awaiter(this, void 0, void 0, function* () {
        const unlock = yield this.lock();
        try {
          return yield Promise.resolve(fn());
        } finally {
          unlock();
        }
      });
    }
  };
  var _a;
  function getGlobal() {
    if (typeof globalThis !== "undefined")
      return globalThis;
    if (typeof self !== "undefined")
      return self;
    if (typeof window !== "undefined")
      return window;
    return global;
  }
  var globalObject = getGlobal();
  var nodeBuffer = (_a = globalObject.Buffer) !== null && _a !== void 0 ? _a : null;
  var textEncoder = globalObject.TextEncoder ? new globalObject.TextEncoder() : null;
  function hexCharCodesToInt(a, b) {
    return (a & 15) + (a >> 6 | a >> 3 & 8) << 4 | (b & 15) + (b >> 6 | b >> 3 & 8);
  }
  function writeHexToUInt8(buf, str) {
    const size = str.length >> 1;
    for (let i = 0; i < size; i++) {
      const index = i << 1;
      buf[i] = hexCharCodesToInt(str.charCodeAt(index), str.charCodeAt(index + 1));
    }
  }
  function hexStringEqualsUInt8(str, buf) {
    if (str.length !== buf.length * 2) {
      return false;
    }
    for (let i = 0; i < buf.length; i++) {
      const strIndex = i << 1;
      if (buf[i] !== hexCharCodesToInt(str.charCodeAt(strIndex), str.charCodeAt(strIndex + 1))) {
        return false;
      }
    }
    return true;
  }
  var alpha = "a".charCodeAt(0) - 10;
  var digit = "0".charCodeAt(0);
  function getDigestHex(tmpBuffer, input, hashLength) {
    let p = 0;
    for (let i = 0; i < hashLength; i++) {
      let nibble = input[i] >>> 4;
      tmpBuffer[p++] = nibble > 9 ? nibble + alpha : nibble + digit;
      nibble = input[i] & 15;
      tmpBuffer[p++] = nibble > 9 ? nibble + alpha : nibble + digit;
    }
    return String.fromCharCode.apply(null, tmpBuffer);
  }
  var getUInt8Buffer = nodeBuffer !== null ? (data) => {
    if (typeof data === "string") {
      const buf = nodeBuffer.from(data, "utf8");
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    }
    if (nodeBuffer.isBuffer(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.length);
    }
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new Error("Invalid data type!");
  } : (data) => {
    if (typeof data === "string") {
      return textEncoder.encode(data);
    }
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new Error("Invalid data type!");
  };
  var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var base64Lookup = new Uint8Array(256);
  for (let i = 0; i < base64Chars.length; i++) {
    base64Lookup[base64Chars.charCodeAt(i)] = i;
  }
  function encodeBase64(data, pad = true) {
    const len = data.length;
    const extraBytes = len % 3;
    const parts = [];
    const len2 = len - extraBytes;
    for (let i = 0; i < len2; i += 3) {
      const tmp = (data[i] << 16 & 16711680) + (data[i + 1] << 8 & 65280) + (data[i + 2] & 255);
      const triplet = base64Chars.charAt(tmp >> 18 & 63) + base64Chars.charAt(tmp >> 12 & 63) + base64Chars.charAt(tmp >> 6 & 63) + base64Chars.charAt(tmp & 63);
      parts.push(triplet);
    }
    if (extraBytes === 1) {
      const tmp = data[len - 1];
      const a = base64Chars.charAt(tmp >> 2);
      const b = base64Chars.charAt(tmp << 4 & 63);
      parts.push(`${a}${b}`);
      if (pad) {
        parts.push("==");
      }
    } else if (extraBytes === 2) {
      const tmp = (data[len - 2] << 8) + data[len - 1];
      const a = base64Chars.charAt(tmp >> 10);
      const b = base64Chars.charAt(tmp >> 4 & 63);
      const c = base64Chars.charAt(tmp << 2 & 63);
      parts.push(`${a}${b}${c}`);
      if (pad) {
        parts.push("=");
      }
    }
    return parts.join("");
  }
  function getDecodeBase64Length(data) {
    let bufferLength = Math.floor(data.length * 0.75);
    const len = data.length;
    if (data[len - 1] === "=") {
      bufferLength -= 1;
      if (data[len - 2] === "=") {
        bufferLength -= 1;
      }
    }
    return bufferLength;
  }
  function decodeBase64(data) {
    const bufferLength = getDecodeBase64Length(data);
    const len = data.length;
    const bytes = new Uint8Array(bufferLength);
    let p = 0;
    for (let i = 0; i < len; i += 4) {
      const encoded1 = base64Lookup[data.charCodeAt(i)];
      const encoded2 = base64Lookup[data.charCodeAt(i + 1)];
      const encoded3 = base64Lookup[data.charCodeAt(i + 2)];
      const encoded4 = base64Lookup[data.charCodeAt(i + 3)];
      bytes[p] = encoded1 << 2 | encoded2 >> 4;
      p += 1;
      bytes[p] = (encoded2 & 15) << 4 | encoded3 >> 2;
      p += 1;
      bytes[p] = (encoded3 & 3) << 6 | encoded4 & 63;
      p += 1;
    }
    return bytes;
  }
  var MAX_HEAP = 16 * 1024;
  var WASM_FUNC_HASH_LENGTH = 4;
  var wasmMutex = new Mutex();
  var wasmModuleCache = /* @__PURE__ */ new Map();
  function WASMInterface(binary, hashLength) {
    return __awaiter(this, void 0, void 0, function* () {
      let wasmInstance = null;
      let memoryView = null;
      let initialized = false;
      if (typeof WebAssembly === "undefined") {
        throw new Error("WebAssembly is not supported in this environment!");
      }
      const writeMemory = (data, offset = 0) => {
        memoryView.set(data, offset);
      };
      const getMemory = () => memoryView;
      const getExports = () => wasmInstance.exports;
      const setMemorySize = (totalSize) => {
        wasmInstance.exports.Hash_SetMemorySize(totalSize);
        const arrayOffset = wasmInstance.exports.Hash_GetBuffer();
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        memoryView = new Uint8Array(memoryBuffer, arrayOffset, totalSize);
      };
      const getStateSize = () => {
        const view = new DataView(wasmInstance.exports.memory.buffer);
        const stateSize = view.getUint32(wasmInstance.exports.STATE_SIZE, true);
        return stateSize;
      };
      const loadWASMPromise = wasmMutex.dispatch(() => __awaiter(this, void 0, void 0, function* () {
        if (!wasmModuleCache.has(binary.name)) {
          const asm = decodeBase64(binary.data);
          const promise = WebAssembly.compile(asm.buffer);
          wasmModuleCache.set(binary.name, promise);
        }
        const module = yield wasmModuleCache.get(binary.name);
        wasmInstance = yield WebAssembly.instantiate(module, {
          // env: {
          //   emscripten_memcpy_big: (dest, src, num) => {
          //     const memoryBuffer = wasmInstance.exports.memory.buffer;
          //     const memView = new Uint8Array(memoryBuffer, 0);
          //     memView.set(memView.subarray(src, src + num), dest);
          //   },
          //   print_memory: (offset, len) => {
          //     const memoryBuffer = wasmInstance.exports.memory.buffer;
          //     const memView = new Uint8Array(memoryBuffer, 0);
          //     console.log('print_int32', memView.subarray(offset, offset + len));
          //   },
          // },
        });
      }));
      const setupInterface = () => __awaiter(this, void 0, void 0, function* () {
        if (!wasmInstance) {
          yield loadWASMPromise;
        }
        const arrayOffset = wasmInstance.exports.Hash_GetBuffer();
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        memoryView = new Uint8Array(memoryBuffer, arrayOffset, MAX_HEAP);
      });
      const init = (bits = null) => {
        initialized = true;
        wasmInstance.exports.Hash_Init(bits);
      };
      const updateUInt8Array = (data) => {
        let read = 0;
        while (read < data.length) {
          const chunk = data.subarray(read, read + MAX_HEAP);
          read += chunk.length;
          memoryView.set(chunk);
          wasmInstance.exports.Hash_Update(chunk.length);
        }
      };
      const update = (data) => {
        if (!initialized) {
          throw new Error("update() called before init()");
        }
        const Uint8Buffer = getUInt8Buffer(data);
        updateUInt8Array(Uint8Buffer);
      };
      const digestChars = new Uint8Array(hashLength * 2);
      const digest = (outputType, padding = null) => {
        if (!initialized) {
          throw new Error("digest() called before init()");
        }
        initialized = false;
        wasmInstance.exports.Hash_Final(padding);
        if (outputType === "binary") {
          return memoryView.slice(0, hashLength);
        }
        return getDigestHex(digestChars, memoryView, hashLength);
      };
      const save = () => {
        if (!initialized) {
          throw new Error("save() can only be called after init() and before digest()");
        }
        const stateOffset = wasmInstance.exports.Hash_GetState();
        const stateLength = getStateSize();
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        const internalState = new Uint8Array(memoryBuffer, stateOffset, stateLength);
        const prefixedState = new Uint8Array(WASM_FUNC_HASH_LENGTH + stateLength);
        writeHexToUInt8(prefixedState, binary.hash);
        prefixedState.set(internalState, WASM_FUNC_HASH_LENGTH);
        return prefixedState;
      };
      const load = (state) => {
        if (!(state instanceof Uint8Array)) {
          throw new Error("load() expects an Uint8Array generated by save()");
        }
        const stateOffset = wasmInstance.exports.Hash_GetState();
        const stateLength = getStateSize();
        const overallLength = WASM_FUNC_HASH_LENGTH + stateLength;
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        if (state.length !== overallLength) {
          throw new Error(`Bad state length (expected ${overallLength} bytes, got ${state.length})`);
        }
        if (!hexStringEqualsUInt8(binary.hash, state.subarray(0, WASM_FUNC_HASH_LENGTH))) {
          throw new Error("This state was written by an incompatible hash implementation");
        }
        const internalState = state.subarray(WASM_FUNC_HASH_LENGTH);
        new Uint8Array(memoryBuffer, stateOffset, stateLength).set(internalState);
        initialized = true;
      };
      const isDataShort = (data) => {
        if (typeof data === "string") {
          return data.length < MAX_HEAP / 4;
        }
        return data.byteLength < MAX_HEAP;
      };
      let canSimplify = isDataShort;
      switch (binary.name) {
        case "argon2":
        case "scrypt":
          canSimplify = () => true;
          break;
        case "blake2b":
        case "blake2s":
          canSimplify = (data, initParam) => initParam <= 512 && isDataShort(data);
          break;
        case "blake3":
          canSimplify = (data, initParam) => initParam === 0 && isDataShort(data);
          break;
        case "xxhash64":
        // cannot simplify
        case "xxhash3":
        case "xxhash128":
        case "crc64":
          canSimplify = () => false;
          break;
      }
      const calculate = (data, initParam = null, digestParam = null) => {
        if (!canSimplify(data, initParam)) {
          init(initParam);
          update(data);
          return digest("hex", digestParam);
        }
        const buffer = getUInt8Buffer(data);
        memoryView.set(buffer);
        wasmInstance.exports.Hash_Calculate(buffer.length, initParam, digestParam);
        return getDigestHex(digestChars, memoryView, hashLength);
      };
      yield setupInterface();
      return {
        getMemory,
        writeMemory,
        getExports,
        setMemorySize,
        init,
        update,
        digest,
        save,
        load,
        calculate,
        hashLength
      };
    });
  }
  var mutex$l = new Mutex();
  var name$k = "argon2";
  var data$k = "AGFzbQEAAAABKQVgAX8Bf2AAAX9gEH9/f39/f39/f39/f39/f38AYAR/f39/AGACf38AAwYFAAECAwQFBgEBAoCAAgYIAX8BQYCABAsHUwUGbWVtb3J5AgAPX19zdGFja19wb2ludGVyAwASSGFzaF9TZXRNZW1vcnlTaXplAAAOSGFzaF9HZXRCdWZmZXIAAQ5IYXNoX0NhbGN1bGF0ZQAECsc2BV0DAX8BfgF/QQAhAQJAIABBACkDiIAEIgKnIgNGDQBBACEBAkAgACADayIAQRB2IABB//8DcUEAR2oiAEAAQX9HDQBB/wHADwtBACACIABBEHStfDcDiIAECyABwAt0AwJ/AX4BfwJAQQAoAoCABCIADQBBAD8AQRB0IgE2AoCABAJAQQApA4iABCICpyIDQYCAIEYNAEEAIQBBgIAgIANrIgNBEHYgA0H//wNxQQBHaiIDQABBf0YNAUEAIAIgA0EQdK18NwOIgAQLIAEhAAsgAAvcDgECfiAAIAQpAwAiECAAKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAMIBAgDCkDAIVCIIkiEDcDACAIIBAgCCkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgBCAQIAQpAwCFQiiJIhA3AwAgACAQIAApAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAwgECAMKQMAhUIwiSIQNwMAIAggECAIKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAEIBAgBCkDAIVCAYk3AwAgASAFKQMAIhAgASkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDSAQIA0pAwCFQiCJIhA3AwAgCSAQIAkpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAUgECAFKQMAhUIoiSIQNwMAIAEgECABKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACANIBAgDSkDAIVCMIkiEDcDACAJIBAgCSkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBSAQIAUpAwCFQgGJNwMAIAIgBikDACIQIAIpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIA4gECAOKQMAhUIgiSIQNwMAIAogECAKKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAGIBAgBikDAIVCKIkiEDcDACACIBAgAikDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgDiAQIA4pAwCFQjCJIhA3AwAgCiAQIAopAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAYgECAGKQMAhUIBiTcDACADIAcpAwAiECADKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAPIBAgDykDAIVCIIkiEDcDACALIBAgCykDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgByAQIAcpAwCFQiiJIhA3AwAgAyAQIAMpAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIA8gECAPKQMAhUIwiSIQNwMAIAsgECALKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAHIBAgBykDAIVCAYk3AwAgACAFKQMAIhAgACkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDyAQIA8pAwCFQiCJIhA3AwAgCiAQIAopAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAUgECAFKQMAhUIoiSIQNwMAIAAgECAAKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAPIBAgDykDAIVCMIkiEDcDACAKIBAgCikDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBSAQIAUpAwCFQgGJNwMAIAEgBikDACIQIAEpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAwgECAMKQMAhUIgiSIQNwMAIAsgECALKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAGIBAgBikDAIVCKIkiEDcDACABIBAgASkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgDCAQIAwpAwCFQjCJIhA3AwAgCyAQIAspAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAYgECAGKQMAhUIBiTcDACACIAcpAwAiECACKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACANIBAgDSkDAIVCIIkiEDcDACAIIBAgCCkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgByAQIAcpAwCFQiiJIhA3AwAgAiAQIAIpAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIA0gECANKQMAhUIwiSIQNwMAIAggECAIKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAHIBAgBykDAIVCAYk3AwAgAyAEKQMAIhAgAykDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDiAQIA4pAwCFQiCJIhA3AwAgCSAQIAkpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAQgECAEKQMAhUIoiSIQNwMAIAMgECADKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAOIBAgDikDAIVCMIkiEDcDACAJIBAgCSkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBCAQIAQpAwCFQgGJNwMAC+MdAQN/QQAhBEEAIAIpAwAgASkDAIU3A5CABEEAIAIpAwggASkDCIU3A5iABEEAIAIpAxAgASkDEIU3A6CABEEAIAIpAxggASkDGIU3A6iABEEAIAIpAyAgASkDIIU3A7CABEEAIAIpAyggASkDKIU3A7iABEEAIAIpAzAgASkDMIU3A8CABEEAIAIpAzggASkDOIU3A8iABEEAIAIpA0AgASkDQIU3A9CABEEAIAIpA0ggASkDSIU3A9iABEEAIAIpA1AgASkDUIU3A+CABEEAIAIpA1ggASkDWIU3A+iABEEAIAIpA2AgASkDYIU3A/CABEEAIAIpA2ggASkDaIU3A/iABEEAIAIpA3AgASkDcIU3A4CBBEEAIAIpA3ggASkDeIU3A4iBBEEAIAIpA4ABIAEpA4ABhTcDkIEEQQAgAikDiAEgASkDiAGFNwOYgQRBACACKQOQASABKQOQAYU3A6CBBEEAIAIpA5gBIAEpA5gBhTcDqIEEQQAgAikDoAEgASkDoAGFNwOwgQRBACACKQOoASABKQOoAYU3A7iBBEEAIAIpA7ABIAEpA7ABhTcDwIEE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";
  var hash$k = "2b50b0d6";
  var wasmJson$k = {
    name: name$k,
    data: data$k,
    hash: hash$k
  };
  var name$j = "blake2b";
  var data$j = "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";
  var hash$j = "22cf500a";
  var wasmJson$j = {
    name: name$j,
    data: data$j,
    hash: hash$j
  };
  var mutex$k = new Mutex();
  function validateBits$4(bits) {
    if (!Number.isInteger(bits) || bits < 8 || bits > 512 || bits % 8 !== 0) {
      return new Error("Invalid variant! Valid values: 8, 16, ..., 512");
    }
    return null;
  }
  function getInitParam$1(outputBits, keyBits) {
    return outputBits | keyBits << 16;
  }
  function createBLAKE2b(bits = 512, key = null) {
    if (validateBits$4(bits)) {
      return Promise.reject(validateBits$4(bits));
    }
    let keyBuffer = null;
    let initParam = bits;
    if (key !== null) {
      keyBuffer = getUInt8Buffer(key);
      if (keyBuffer.length > 64) {
        return Promise.reject(new Error("Max key length is 64 bytes"));
      }
      initParam = getInitParam$1(bits, keyBuffer.length);
    }
    const outputSize = bits / 8;
    return WASMInterface(wasmJson$j, outputSize).then((wasm) => {
      if (initParam > 512) {
        wasm.writeMemory(keyBuffer);
      }
      wasm.init(initParam);
      const obj = {
        init: initParam > 512 ? () => {
          wasm.writeMemory(keyBuffer);
          wasm.init(initParam);
          return obj;
        } : () => {
          wasm.init(initParam);
          return obj;
        },
        update: (data) => {
          wasm.update(data);
          return obj;
        },
        // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
        digest: (outputType) => wasm.digest(outputType),
        save: () => wasm.save(),
        load: (data) => {
          wasm.load(data);
          return obj;
        },
        blockSize: 128,
        digestSize: outputSize
      };
      return obj;
    });
  }
  function encodeResult(salt, options, res) {
    const parameters = [
      `m=${options.memorySize}`,
      `t=${options.iterations}`,
      `p=${options.parallelism}`
    ].join(",");
    return `$argon2${options.hashType}$v=19$${parameters}$${encodeBase64(salt, false)}$${encodeBase64(res, false)}`;
  }
  var uint32View = new DataView(new ArrayBuffer(4));
  function int32LE(x) {
    uint32View.setInt32(0, x, true);
    return new Uint8Array(uint32View.buffer);
  }
  function hashFunc(blake512, buf, len) {
    return __awaiter(this, void 0, void 0, function* () {
      if (len <= 64) {
        const blake = yield createBLAKE2b(len * 8);
        blake.update(int32LE(len));
        blake.update(buf);
        return blake.digest("binary");
      }
      const r = Math.ceil(len / 32) - 2;
      const ret = new Uint8Array(len);
      blake512.init();
      blake512.update(int32LE(len));
      blake512.update(buf);
      let vp = blake512.digest("binary");
      ret.set(vp.subarray(0, 32), 0);
      for (let i = 1; i < r; i++) {
        blake512.init();
        blake512.update(vp);
        vp = blake512.digest("binary");
        ret.set(vp.subarray(0, 32), i * 32);
      }
      const partialBytesNeeded = len - 32 * r;
      let blakeSmall;
      if (partialBytesNeeded === 64) {
        blakeSmall = blake512;
        blakeSmall.init();
      } else {
        blakeSmall = yield createBLAKE2b(partialBytesNeeded * 8);
      }
      blakeSmall.update(vp);
      vp = blakeSmall.digest("binary");
      ret.set(vp.subarray(0, partialBytesNeeded), r * 32);
      return ret;
    });
  }
  function getHashType(type) {
    switch (type) {
      case "d":
        return 0;
      case "i":
        return 1;
      default:
        return 2;
    }
  }
  function argon2Internal(options) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a2;
      const { parallelism, iterations, hashLength } = options;
      const password = getUInt8Buffer(options.password);
      const salt = getUInt8Buffer(options.salt);
      const version = 19;
      const hashType = getHashType(options.hashType);
      const { memorySize } = options;
      const secret = getUInt8Buffer((_a2 = options.secret) !== null && _a2 !== void 0 ? _a2 : "");
      const [argon2Interface, blake512] = yield Promise.all([
        WASMInterface(wasmJson$k, 1024),
        createBLAKE2b(512)
      ]);
      argon2Interface.setMemorySize(memorySize * 1024 + 1024);
      const initVector = new Uint8Array(24);
      const initVectorView = new DataView(initVector.buffer);
      initVectorView.setInt32(0, parallelism, true);
      initVectorView.setInt32(4, hashLength, true);
      initVectorView.setInt32(8, memorySize, true);
      initVectorView.setInt32(12, iterations, true);
      initVectorView.setInt32(16, version, true);
      initVectorView.setInt32(20, hashType, true);
      argon2Interface.writeMemory(initVector, memorySize * 1024);
      blake512.init();
      blake512.update(initVector);
      blake512.update(int32LE(password.length));
      blake512.update(password);
      blake512.update(int32LE(salt.length));
      blake512.update(salt);
      blake512.update(int32LE(secret.length));
      blake512.update(secret);
      blake512.update(int32LE(0));
      const segments = Math.floor(memorySize / (parallelism * 4));
      const lanes = segments * 4;
      const param = new Uint8Array(72);
      const H0 = blake512.digest("binary");
      param.set(H0);
      for (let lane = 0; lane < parallelism; lane++) {
        param.set(int32LE(0), 64);
        param.set(int32LE(lane), 68);
        let position = lane * lanes;
        let chunk = yield hashFunc(blake512, param, 1024);
        argon2Interface.writeMemory(chunk, position * 1024);
        position += 1;
        param.set(int32LE(1), 64);
        chunk = yield hashFunc(blake512, param, 1024);
        argon2Interface.writeMemory(chunk, position * 1024);
      }
      const C = new Uint8Array(1024);
      writeHexToUInt8(C, argon2Interface.calculate(new Uint8Array([]), memorySize));
      const res = yield hashFunc(blake512, C, hashLength);
      if (options.outputType === "hex") {
        const digestChars = new Uint8Array(hashLength * 2);
        return getDigestHex(digestChars, res, hashLength);
      }
      if (options.outputType === "encoded") {
        return encodeResult(salt, options, res);
      }
      return res;
    });
  }
  var validateOptions$3 = (options) => {
    var _a2;
    if (!options || typeof options !== "object") {
      throw new Error("Invalid options parameter. It requires an object.");
    }
    if (!options.password) {
      throw new Error("Password must be specified");
    }
    options.password = getUInt8Buffer(options.password);
    if (options.password.length < 1) {
      throw new Error("Password must be specified");
    }
    if (!options.salt) {
      throw new Error("Salt must be specified");
    }
    options.salt = getUInt8Buffer(options.salt);
    if (options.salt.length < 8) {
      throw new Error("Salt should be at least 8 bytes long");
    }
    options.secret = getUInt8Buffer((_a2 = options.secret) !== null && _a2 !== void 0 ? _a2 : "");
    if (!Number.isInteger(options.iterations) || options.iterations < 1) {
      throw new Error("Iterations should be a positive number");
    }
    if (!Number.isInteger(options.parallelism) || options.parallelism < 1) {
      throw new Error("Parallelism should be a positive number");
    }
    if (!Number.isInteger(options.hashLength) || options.hashLength < 4) {
      throw new Error("Hash length should be at least 4 bytes.");
    }
    if (!Number.isInteger(options.memorySize)) {
      throw new Error("Memory size should be specified.");
    }
    if (options.memorySize < 8 * options.parallelism) {
      throw new Error("Memory size should be at least 8 * parallelism.");
    }
    if (options.outputType === void 0) {
      options.outputType = "hex";
    }
    if (!["hex", "binary", "encoded"].includes(options.outputType)) {
      throw new Error(`Insupported output type ${options.outputType}. Valid values: ['hex', 'binary', 'encoded']`);
    }
  };
  function argon2id(options) {
    return __awaiter(this, void 0, void 0, function* () {
      validateOptions$3(options);
      return argon2Internal(Object.assign(Object.assign({}, options), { hashType: "id" }));
    });
  }
  var mutex$j = new Mutex();
  var mutex$i = new Mutex();
  var mutex$h = new Mutex();
  var mutex$g = new Mutex();
  var polyBuffer = new Uint8Array(8);
  var mutex$f = new Mutex();
  var mutex$e = new Mutex();
  var mutex$d = new Mutex();
  var mutex$c = new Mutex();
  var mutex$b = new Mutex();
  var mutex$a = new Mutex();
  var mutex$9 = new Mutex();
  var mutex$8 = new Mutex();
  var mutex$7 = new Mutex();
  var mutex$6 = new Mutex();
  var mutex$5 = new Mutex();
  var seedBuffer$2 = new Uint8Array(8);
  var mutex$4 = new Mutex();
  var seedBuffer$1 = new Uint8Array(8);
  var mutex$3 = new Mutex();
  var seedBuffer = new Uint8Array(8);
  var mutex$2 = new Mutex();
  var mutex$1 = new Mutex();
  var mutex = new Mutex();

  // crypto.ts
  var KDF_METADATA = Object.freeze({
    algorithm: "argon2id",
    version: 19,
    memoryKiB: 19456,
    iterations: 2,
    parallelism: 1,
    keyBytes: 32
  });
  var FORMAT_VERSION = 1;
  var SALT_BYTES = 16;
  var IV_BYTES = 12;
  var MAX_PASSPHRASE_BYTES = 1024;
  var MAX_CIPHERTEXT_BYTES = 15e5;
  var encoder = new TextEncoder();
  var decoder = new TextDecoder("utf-8", { fatal: true });
  function assertCrypto(provider) {
    if (!provider?.subtle || typeof provider.getRandomValues !== "function") {
      throw new Error("Web Crypto is unavailable in this browser context.");
    }
  }
  function aadFor(revision, updatedAt) {
    return encoder.encode(
      `IDENCIFIED|VAULT_FORMAT=1|REVISION=${revision}|UPDATED_AT=${updatedAt}|ARGON2ID=v=19,m=19456,t=2,p=1|AES-256-GCM`
    );
  }
  function toBase64(bytes) {
    let binary = "";
    const chunkSize = 32768;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }
  function fromBase64(value, expectedLength, maximumLength = MAX_CIPHERTEXT_BYTES) {
    if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maximumLength * 4 / 3) + 4) {
      throw new VaultCorruptError();
    }
    let binary;
    try {
      binary = atob(value);
    } catch {
      throw new VaultCorruptError();
    }
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (bytes.length > maximumLength || expectedLength !== void 0 && bytes.length !== expectedLength || toBase64(bytes) !== value) {
      bytes.fill(0);
      throw new VaultCorruptError();
    }
    return bytes;
  }
  function normalizePassphrase(passphrase) {
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
  async function deriveAesKey(passphrase, salt, provider) {
    const normalized = normalizePassphrase(passphrase);
    const derived = await argon2id({
      password: normalized,
      salt,
      parallelism: KDF_METADATA.parallelism,
      iterations: KDF_METADATA.iterations,
      memorySize: KDF_METADATA.memoryKiB,
      hashLength: KDF_METADATA.keyBytes,
      outputType: "binary"
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
        ["encrypt", "decrypt"]
      );
    } finally {
      rawKey.fill(0);
      derived.fill(0);
    }
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function hasExactKeys2(value, expected) {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
  }
  function validateEnvelope(value) {
    if (!isRecord(value) || !hasExactKeys2(value, ["id", "formatVersion", "revision", "updatedAt", "salt", "kdf", "cipher"])) {
      throw new VaultCorruptError();
    }
    if (value.id !== "primary" || value.formatVersion !== FORMAT_VERSION || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.updatedAt !== "number" || !Number.isSafeInteger(value.updatedAt) || value.updatedAt <= 0) {
      throw new VaultCorruptError();
    }
    if (!isRecord(value.kdf) || !hasExactKeys2(value.kdf, ["algorithm", "version", "memoryKiB", "iterations", "parallelism", "keyBytes"])) {
      throw new VaultCorruptError();
    }
    if (value.kdf.algorithm !== KDF_METADATA.algorithm || value.kdf.version !== KDF_METADATA.version || value.kdf.memoryKiB !== KDF_METADATA.memoryKiB || value.kdf.iterations !== KDF_METADATA.iterations || value.kdf.parallelism !== KDF_METADATA.parallelism || value.kdf.keyBytes !== KDF_METADATA.keyBytes) {
      throw new VaultCorruptError();
    }
    if (!isRecord(value.cipher) || !hasExactKeys2(value.cipher, ["algorithm", "iv", "ciphertext"]) || value.cipher.algorithm !== "AES-256-GCM") {
      throw new VaultCorruptError();
    }
    const saltBytes = fromBase64(value.salt, SALT_BYTES, SALT_BYTES);
    const ivBytes = fromBase64(value.cipher.iv, IV_BYTES, IV_BYTES);
    const ciphertextBytes = fromBase64(value.cipher.ciphertext, void 0, MAX_CIPHERTEXT_BYTES);
    const ciphertextValid = ciphertextBytes.length >= 16;
    saltBytes.fill(0);
    ivBytes.fill(0);
    ciphertextBytes.fill(0);
    if (!ciphertextValid) throw new VaultCorruptError();
    return {
      id: "primary",
      formatVersion: 1,
      revision: value.revision,
      updatedAt: value.updatedAt,
      salt: value.salt,
      kdf: KDF_METADATA,
      cipher: {
        algorithm: "AES-256-GCM",
        iv: value.cipher.iv,
        ciphertext: value.cipher.ciphertext
      }
    };
  }
  async function createEncryptedEnvelope(passphrase, payload, revision, provider = crypto) {
    assertCrypto(provider);
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new ValidationError("Invalid vault revision.");
    }
    const validPayload = validateVaultPayload(payload);
    const plaintext = encoder.encode(JSON.stringify(validPayload));
    if (plaintext.length > 1e6) {
      plaintext.fill(0);
      throw new ValidationError("The vault is too large to save.");
    }
    const salt = new Uint8Array(new ArrayBuffer(SALT_BYTES));
    const iv = new Uint8Array(new ArrayBuffer(IV_BYTES));
    let aad;
    try {
      provider.getRandomValues(salt);
      provider.getRandomValues(iv);
      const key = await deriveAesKey(passphrase, salt, provider);
      const updatedAt = Date.now();
      aad = aadFor(revision, updatedAt);
      const encrypted = await provider.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
        key,
        plaintext
      );
      const envelope = {
        id: "primary",
        formatVersion: FORMAT_VERSION,
        revision,
        updatedAt,
        salt: toBase64(salt),
        kdf: KDF_METADATA,
        cipher: {
          algorithm: "AES-256-GCM",
          iv: toBase64(iv),
          ciphertext: toBase64(new Uint8Array(encrypted))
        }
      };
      return { envelope, key };
    } finally {
      plaintext.fill(0);
      salt.fill(0);
      iv.fill(0);
      aad?.fill(0);
    }
  }
  async function encryptPayloadWithKey(key, saltBase64, payload, revision, provider = crypto) {
    assertCrypto(provider);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new ValidationError("Invalid vault revision.");
    const salt = fromBase64(saltBase64, SALT_BYTES, SALT_BYTES);
    let plaintext;
    const iv = new Uint8Array(new ArrayBuffer(IV_BYTES));
    let aad;
    try {
      const validPayload = validateVaultPayload(payload);
      plaintext = encoder.encode(JSON.stringify(validPayload));
      if (plaintext.length > 1e6) {
        throw new ValidationError("The vault is too large to save.");
      }
      provider.getRandomValues(iv);
      const updatedAt = Date.now();
      aad = aadFor(revision, updatedAt);
      const encrypted = await provider.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
        key,
        plaintext
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
          ciphertext: toBase64(new Uint8Array(encrypted))
        }
      };
    } finally {
      salt.fill(0);
      plaintext?.fill(0);
      iv.fill(0);
      aad?.fill(0);
    }
  }
  async function decryptEnvelope(passphrase, untrustedEnvelope, provider = crypto) {
    assertCrypto(provider);
    const envelope = validateEnvelope(untrustedEnvelope);
    const salt = fromBase64(envelope.salt, SALT_BYTES, SALT_BYTES);
    const iv = fromBase64(envelope.cipher.iv, IV_BYTES, IV_BYTES);
    const ciphertext = fromBase64(envelope.cipher.ciphertext, void 0, MAX_CIPHERTEXT_BYTES);
    const aad = aadFor(envelope.revision, envelope.updatedAt);
    let plaintext;
    try {
      const key = await deriveAesKey(passphrase, salt, provider);
      let decrypted;
      try {
        decrypted = await provider.subtle.decrypt(
          { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
          key,
          ciphertext
        );
      } catch {
        throw new VaultUnlockError();
      }
      plaintext = new Uint8Array(decrypted);
      let parsed;
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

  // vault.ts
  async function createVault(store2, passphrase) {
    if (await store2.read()) {
      throw new VaultAlreadyExistsError();
    }
    const payload = { schemaVersion: 1, identities: [] };
    const { envelope, key } = await createEncryptedEnvelope(passphrase, payload, 1);
    await store2.create(envelope);
    return { key, salt: envelope.salt, revision: envelope.revision, payload };
  }
  async function unlockVault(store2, passphrase) {
    const saved = await store2.read();
    if (!saved) {
      throw new VaultNotFoundError();
    }
    const result = await decryptEnvelope(passphrase, saved);
    return {
      key: result.key,
      salt: result.envelope.salt,
      revision: result.envelope.revision,
      payload: result.payload
    };
  }
  async function saveVault(store2, session2) {
    const rawCurrent = await store2.read();
    if (!rawCurrent) {
      throw new VaultNotFoundError();
    }
    const current = validateEnvelope(rawCurrent);
    if (current.revision !== session2.revision || current.salt !== session2.salt) {
      throw new VaultConflictError();
    }
    const payload = validateVaultPayload(session2.payload);
    const next = await encryptPayloadWithKey(session2.key, current.salt, payload, current.revision + 1);
    await store2.compareAndSwap(current.revision, current.salt, next);
    return {
      key: session2.key,
      salt: next.salt,
      revision: next.revision,
      payload
    };
  }

  // main.ts
  var store = new IndexedDbVaultStore();
  var AUTO_LOCK_MS = 5 * 60 * 1e3;
  var session = null;
  var sessionEpoch = 0;
  var autoLockTimer;
  function element(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing required UI element: ${id}`);
    return node;
  }
  var setupView = element("setup-view");
  var unlockView = element("unlock-view");
  var vaultView = element("vault-view");
  var statusMessage = element("status-message");
  var setupForm = element("setup-form");
  var unlockForm = element("unlock-form");
  var identityForm = element("identity-form");
  var addPanel = element("add-panel");
  var identityList = element("identity-list");
  var emptyState = element("empty-state");
  function showView(view) {
    setupView.hidden = view !== "setup";
    unlockView.hidden = view !== "unlock";
    vaultView.hidden = view !== "vault";
  }
  function showStatus(message, kind = "success") {
    statusMessage.textContent = message;
    statusMessage.classList.toggle("error", kind === "error");
    statusMessage.hidden = false;
  }
  function clearStatus() {
    statusMessage.textContent = "";
    statusMessage.hidden = true;
    statusMessage.classList.remove("error");
  }
  function readField(id) {
    return element(id).value;
  }
  function writeField(id, value) {
    element(id).value = value;
  }
  function clearIdentityForm() {
    for (const id of ["identity-origin", "identity-label", "identity-email", "identity-username", "identity-phone", "identity-address"]) {
      writeField(id, "");
    }
  }
  function showAddPanel(show) {
    addPanel.hidden = !show;
    if (show) {
      element("identity-origin").focus();
    }
  }
  function startAutoLock() {
    if (autoLockTimer !== void 0) window.clearTimeout(autoLockTimer);
    autoLockTimer = window.setTimeout(() => lockVault("Your vault locked after five minutes of inactivity."), AUTO_LOCK_MS);
  }
  function lockVault(message = "Your vault is locked.") {
    sessionEpoch += 1;
    session = null;
    if (autoLockTimer !== void 0) window.clearTimeout(autoLockTimer);
    autoLockTimer = void 0;
    showAddPanel(false);
    clearIdentityForm();
    identityList.replaceChildren();
    element("identity-count").textContent = "Vault locked";
    showView("unlock");
    showStatus(message);
    element("unlock-passphrase").value = "";
  }
  function createText(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }
  function renderIdentity(record) {
    const card = document.createElement("article");
    card.className = "identity-card";
    const header = document.createElement("div");
    header.className = "identity-card-head";
    const site = document.createElement("div");
    site.className = "identity-site";
    site.append(
      createText("strong", "", record.label || new URL(record.origin).hostname),
      createText("span", "", record.origin)
    );
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => void removeIdentity(record.id));
    header.append(site, remove);
    card.append(header);
    const details = document.createElement("dl");
    details.className = "identity-details";
    const fields = [
      ["Email", record.emailAlias],
      ["Username", record.usernameAlias],
      ["Phone", record.phoneAlias],
      ["Address", record.addressAlias]
    ];
    for (const [label, value] of fields) {
      if (!value) continue;
      const row = document.createElement("div");
      row.className = "identity-detail";
      row.append(createText("dt", "", label), createText("dd", "", value));
      details.append(row);
    }
    card.append(details);
    return card;
  }
  function renderVault() {
    if (!session) return;
    const identities = [...session.payload.identities].sort((a, b) => b.updatedAt - a.updatedAt);
    element("identity-count").textContent = `${identities.length} saved ${identities.length === 1 ? "identity" : "identities"}`;
    emptyState.hidden = identities.length !== 0;
    identityList.replaceChildren(...identities.map(renderIdentity));
  }
  async function removeIdentity(id) {
    if (!session) return;
    const record = session.payload.identities.find((item) => item.id === id);
    if (!record) return;
    if (!window.confirm(`Remove the saved identity for ${record.origin}?`)) return;
    const operationEpoch = sessionEpoch;
    try {
      const nextPayload = {
        schemaVersion: 1,
        identities: session.payload.identities.filter((item) => item.id !== id)
      };
      const saved = await saveVault(store, { ...session, payload: nextPayload });
      if (sessionEpoch !== operationEpoch) return;
      session = saved;
      renderVault();
      startAutoLock();
      showStatus("Identity removed from your encrypted vault.");
    } catch (error) {
      if (sessionEpoch === operationEpoch) {
        handleVaultError(error, "Could not remove that identity.");
      }
    }
  }
  function handleVaultError(error, fallback) {
    if (error instanceof VaultUnlockError) {
      showStatus("That passphrase didn't unlock the vault. Check it and try again.", "error");
      return;
    }
    if (error instanceof VaultConflictError) {
      lockVault("The vault changed elsewhere. Unlock again before continuing.");
      return;
    }
    if (error instanceof VaultAlreadyExistsError) {
      showStatus("A vault was created in another window. Close this popup and reopen it.", "error");
      return;
    }
    if (error instanceof ValidationError) {
      showStatus(error.message, "error");
      return;
    }
    showStatus(fallback, "error");
  }
  setupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearStatus();
    const passphrase = readField("setup-passphrase");
    const confirmation = readField("setup-confirm");
    if (passphrase !== confirmation) {
      showStatus("Those passphrases don't match yet.", "error");
      return;
    }
    const submitButton = setupForm.querySelector('button[type="submit"]');
    if (submitButton?.disabled) return;
    if (submitButton) submitButton.disabled = true;
    const operationEpoch = sessionEpoch;
    void createVault(store, passphrase).then((created) => {
      if (sessionEpoch !== operationEpoch) return;
      sessionEpoch += 1;
      session = created;
      writeField("setup-passphrase", "");
      writeField("setup-confirm", "");
      showView("vault");
      renderVault();
      startAutoLock();
      showStatus("Your encrypted vault is ready. Add an alias you already use.");
    }).catch((error) => {
      if (sessionEpoch === operationEpoch) {
        handleVaultError(error, "Couldn't create the local vault. Check that browser storage is available.");
      }
    }).finally(() => {
      writeField("setup-passphrase", "");
      writeField("setup-confirm", "");
      if (submitButton) submitButton.disabled = false;
    });
  });
  unlockForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearStatus();
    const submitButton = unlockForm.querySelector('button[type="submit"]');
    if (submitButton?.disabled) return;
    if (submitButton) submitButton.disabled = true;
    const operationEpoch = sessionEpoch;
    const passphrase = readField("unlock-passphrase");
    void unlockVault(store, passphrase).then((unlocked) => {
      if (sessionEpoch !== operationEpoch) return;
      sessionEpoch += 1;
      session = unlocked;
      writeField("unlock-passphrase", "");
      showView("vault");
      renderVault();
      startAutoLock();
      showStatus("Vault unlocked. Your saved aliases are ready.");
    }).catch((error) => {
      if (sessionEpoch === operationEpoch) {
        handleVaultError(error, "Couldn't unlock the vault.");
      }
    }).finally(() => {
      writeField("unlock-passphrase", "");
      if (submitButton) submitButton.disabled = false;
    });
  });
  identityForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearStatus();
    if (!session) {
      lockVault();
      return;
    }
    try {
      const record = makeIdentityRecord({
        origin: readField("identity-origin"),
        label: readField("identity-label"),
        emailAlias: readField("identity-email"),
        usernameAlias: readField("identity-username"),
        phoneAlias: readField("identity-phone"),
        addressAlias: readField("identity-address")
      });
      if (session.payload.identities.length >= 250) {
        throw new ValidationError("The starter vault is limited to 250 identities for now.");
      }
      if (session.payload.identities.some((item) => item.origin === record.origin)) {
        throw new ValidationError("You already have an identity saved for this exact website origin.");
      }
      const nextPayload = {
        schemaVersion: 1,
        identities: [...session.payload.identities, record]
      };
      const operationEpoch = sessionEpoch;
      void saveVault(store, { ...session, payload: nextPayload }).then((saved) => {
        if (sessionEpoch !== operationEpoch) return;
        session = saved;
        clearIdentityForm();
        showAddPanel(false);
        renderVault();
        startAutoLock();
        showStatus("Saved. That alias is now stored encrypted on this device.");
      }).catch((error) => {
        if (sessionEpoch === operationEpoch) {
          handleVaultError(error, "Couldn't save that identity.");
        }
      });
    } catch (error) {
      handleVaultError(error, "Check the details and try again.");
    }
  });
  element("show-add-button").addEventListener("click", () => showAddPanel(true));
  element("empty-add-button").addEventListener("click", () => showAddPanel(true));
  element("cancel-add-button").addEventListener("click", () => {
    clearIdentityForm();
    showAddPanel(false);
  });
  element("lock-button").addEventListener("click", () => lockVault("Vault locked."));
  for (const eventName of ["pointerdown", "keydown", "input"]) {
    document.addEventListener(eventName, () => {
      if (session) startAutoLock();
    }, { passive: true });
  }
  window.addEventListener("pagehide", () => {
    sessionEpoch += 1;
    session = null;
    identityList.replaceChildren();
    if (autoLockTimer !== void 0) window.clearTimeout(autoLockTimer);
  });
  async function initialise() {
    try {
      const saved = await store.read();
      showView(saved ? "unlock" : "setup");
    } catch {
      showView("setup");
      showStatus("Local encrypted storage isn't available. Your information has not been saved.", "error");
    }
  }
  void initialise();
})();
