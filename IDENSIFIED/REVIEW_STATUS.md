# IDENCIFIED 0.1.0 — implementation and review status

**Snapshot date:** 19 November 2026  
**Status:** Early prototype; not production-ready.

## Implemented in this snapshot

- Firefox Manifest V3 popup shell.
- No host permissions, API permissions, content scripts, background scripts, telemetry or network requests.
- Local IndexedDB store for a single encrypted vault envelope.
- Argon2id passphrase derivation (19 MiB, 2 iterations, 1 lane) through the pinned `hash-wasm` 4.13.0 package.
- Non-extractable AES-256-GCM key, 96-bit random IV, 128-bit authentication tag.
- Authenticated additional data binds the envelope format, KDF profile, revision and update timestamp.
- Strict vault envelope and decrypted payload validation, size limits and exact HTTPS-origin binding.
- Basic create, unlock, add identity, remove identity and five-minute inactivity lock flows.
- UI uses DOM node creation and `textContent` for user-provided values.
- Type-only future REDSEC assessment contract; no REDSEC integration yet.

## Checks completed in this environment

- Five origin and payload-validation tests passed using Node's TypeScript type-stripping test runner.
- Application source passed a strict TypeScript check using a temporary declaration for `hash-wasm` because dependencies were not installed. This is a source-level check, not the project's normal npm typecheck.
- Build script passed `node --check`.
- Manual source review covered extension permissions/CSP, user-text rendering, vault envelope validation, cryptographic input bounds, lock handling and IndexedDB update logic.
- Hardened compare-and-swap to check both the expected revision and salt, preventing a stale session from overwriting a deleted-and-recreated vault that happens to reuse a revision number.
- Added operation-generation guards so failures from an old asynchronous save/unlock operation cannot affect a newer unlocked session.

## Not yet verified

- `npm install` and generation/review of `package-lock.json` (the package registry was unavailable in the work environment).
- Full `npm run typecheck`, full `npm test` including Argon2id/AES-GCM vault tests, and `npm run build`.
- Runtime behaviour in Firefox, including WebAssembly loading under the declared extension CSP.
- IndexedDB transaction behaviour across two simultaneous Firefox popup windows and browser shutdown.
- `npm audit`, independent dependency/supply-chain review, and formal cryptographic review.
- Cross-browser compatibility, AMO review, accessibility review and production signing.

## Known limitations

- No backup/export/recovery. Losing the browser profile or forgetting the passphrase can permanently lose the vault.
- The vault stores values the user already controls; it does not create or route real aliases.
- No safe autofill, website scanning, REDSEC connection, account system, sync, mobile integration, or browser/network fingerprint protections.
- JavaScript cannot guarantee immediate zeroization of all copies of sensitive values in memory.
- This prototype does not protect against a compromised operating system, browser profile, keylogger or malicious extension with equivalent privileges.

## Release rule

Do not store important personal aliases in this prototype until the pending dependency install, complete test suite, Firefox runtime test, backup/recovery design and independent security review are complete.
