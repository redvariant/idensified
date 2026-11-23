This is a project I’ve been working on with AI. I’m not a developer, but essentially, Idensified is intended to be a plug-in that helps everyday users decide when they shouldn’t share their real identifying information.

I’m well aware that similar plug-ins already exist, but I wanted Idensified to be user-friendly and to perform a full website scan—not a partial one. The scan would check front-end code, tech stacks, and frameworks, then look for vulnerabilities using established sources such as CVE.org and the NIST National Vulnerability Database (NVD), as well as other vulnerability databases. The goal is to translate the findings into simple, practical steps, such as using an alias, masking an IP address, or taking other protective measures.

My main focus was to make sure the plug-in wouldn’t block users from accessing websites. That didn’t make sense to me. Instead, I wanted Idensified to provide relevant, actionable information that gives people more confidence when using the websites they visit regularly. Current applications that provide this kind of security often block access and explain why in essays full of technical language. I think a more logical approach is to let users know when they may want to protect themselves from potential secondary data exposure or the potentially serious loss of personal information due to a website owner’s negligence.

I wanted Idensified to help people strengthen their online identity and run background checks on websites, so the playing field is fairer. Many websites use a range of measures to gather data about everyday users; it seems only fair that users should have a similar level of insight and awareness. This could help people understand the potential risks of using the internet while also giving them tools to protect themselves.

I’ve used AI to help sketch out the first version of this project. It’s a work in progress, not a finished security tool. I’m sharing it to invite feedback and contributions from people with different levels of security and web development experience. The core principle is: it informs; it doesn’t restrict. That makes Idensified’s approach clear and keeps it honest—qualities I think people will respect.
I wanted it to be an open-source project because I’m currently studying cybersecurity, and have no idea how to build something of this level.

-----------------------------------------------------------------------------------------------------------------------------------------

(IDENSIFIED) = ID - DENSE - IDENTIFIED as in density for your identity.

-----------------------------------------------------------------------------------------------------------------------------------------
Currently I've got: 

- Argon2id passphrase-based key derivation.
- AES-256-GCM encryption.
- A locally encrypted identity vault.
- Random salt and initialisation vectors.
- Strict validation of stored data.
- HTTPS-origin binding for stored identities.
- IndexedDB storage.
- A five-minute inactivity lock.
- Revision checks intended to prevent stale sessions overwriting newer vault data.
- DOM rendering using textContent to reduce injection risks.
note: I fought with AI to implement the best security possible but there will probably be some mistakes.
------------------------------------------------------------------------------------------------------------------------------------------
Initial browser extension prototype:

- manifest.json - Browser extension configuration
- popup.html - Extension popup interface
- main.ts - Main application logic
- crypto.ts - Cryptographic operations
- vault.ts -  Encrypted vault functionality
- idb-store.ts - IndexedDB persistence
- validation.ts - Input and data validation
- errors.ts - Error handling
- types.ts - TypeScript definitions
- styles.css - Interface styling
- scripts/build.mjs - Build process

