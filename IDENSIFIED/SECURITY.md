# Security notes and disclosure

## Scope

This repository is an early local-vault prototype, not a production-ready identity-management product. The current version has no page access, scanner, autofill, forwarding infrastructure, account system or network service.

## Implemented controls

- No API or host permissions in the extension manifest.
- No content scripts, background scripts, external code, remote dependencies at runtime or telemetry.
- Argon2id key derivation (16-character minimum passphrase) with a random 128-bit salt and OWASP's 19 MiB / 2-pass / 1-lane minimum profile.
- Non-extractable Web Crypto AES-GCM key, 256-bit key length, random 96-bit IV per encryption and 128-bit authentication tag.
- Authenticated additional data binds ciphertext to the fixed vault format and KDF profile.
- Strict metadata and payload schema validation; unknown fields are rejected.
- Size bounds on passphrases, ciphertext, field lengths and identity count.
- Exact HTTPS-origin binding for stored identity records.
- User-controlled strings are rendered as text nodes, not HTML.
- IndexedDB write transactions compare both the expected revision and salt, preventing ordinary stale-session writes from replacing a deleted-and-recreated vault.
- No plaintext identity values are intentionally written to persistent storage.

## Known limitations / open work

- No encrypted backup or recovery process exists yet.
- Browser/device malware, keyloggers, compromised browser profiles and malicious extensions are out of scope.
- JavaScript memory zeroization cannot be guaranteed.
- The popup-only five-minute timer is not a system-wide session manager; closing the popup drops the JS references, but browser process memory reclamation is implementation-dependent.
- There is no secure autofill yet. Origin binding is a storage invariant, not an autofill control.
- The REDSEC contract is a type-only future boundary; no REDSEC results are accepted yet.
- No cross-browser testing, AMO review, independent cryptographic audit or full supply-chain review has been completed.
- The current create flow checks for an existing vault before deriving the key; IndexedDB `add` also rejects an existing primary key. Both paths must be exercised in Firefox.
- The vault cannot prove that a value entered by the user is actually a masked alias rather than a real personal detail. The UI instructs users to enter aliases only.

## Reporting

Do not publish details of an undisclosed vulnerability. For this prototype, report suspected issues privately to the project maintainer with a reproducible test case and affected revision.
