This is a project I’ve been working on with AI. I’m not a developer, but essentially, Idensified is intended to be a plug-in that helps everyday users decide when they shouldn’t share their real identifying information.

I’m well aware that similar plug-ins already exist, but I wanted Idensified to be user-friendly and to perform a full website scan—not a partial one. The scan would check front-end code, tech stacks, and frameworks, then look for vulnerabilities using established sources such as CVE.org and the NIST National Vulnerability Database (NVD), as well as other vulnerability databases. The goal is to translate the findings into simple, practical steps, such as using an alias, masking an IP address, or taking other protective measures.

My main focus was to make sure the plug-in wouldn’t block users from accessing websites. That didn’t make sense to me. Instead, I wanted Idensified to provide relevant, actionable information that gives people more confidence when using the websites they visit regularly. Current applications that provide this kind of security often block access and explain why in essays full of technical language. I think a more logical approach is to let users know when they may want to protect themselves from potential secondary data exposure or the potentially serious loss of personal information due to a website owner’s negligence.

I wanted Idensified to help people strengthen their online identity and run background checks on websites, so the playing field is fairer. Many websites use a range of measures to gather data about everyday users; it seems only fair that users should have a similar level of insight and awareness. This could help people understand the potential risks of using the internet while also giving them tools to protect themselves.

I’ve used AI to help sketch out the first version of this project. It’s a work in progress, not a finished security tool. I’m sharing it to invite feedback and contributions from people with different levels of security and web development experience. The core principle is: it informs; it doesn’t restrict. That makes Idensified’s approach clear and keeps it honest—qualities I think people will respect.

I wanted it to be an open-source project because I’m currently studying cybersecurity. Honestly, the lack of security awareness on many websites is astonishing. I keep thinking about how disadvantaged people can be when they aren’t aware of the potential weaknesses in the websites they use.
-----------------------------------------------------------------------------------------------------------------------------------------

(IDENSIFIED) = ID - DENSE - IDENTIFIED as in density for your identity.

-----------------------------------------------------------------------------------------------------------------------------------------

Currently Ive got:
</> Markdown
1.Argon2id passphrase-based key derivation.
2.AES-256-GCM encryption.
3.A locally encrypted identity vault.
4.Random salt and initialisation vectors.
5.Strict validation of stored data.
6.HTTPS-origin binding for stored identities.
7.IndexedDB storage.
8.A five-minute inactivity lock.
9.Revision checks intended to prevent stale sessions overwriting newer vault data.
10.DOM rendering using textContent to reduce injection risks.
note: I fought with AI to implement the best security possible but there will probably be some mistakes.
------------------------------------------------------------------------------------------------------------------------------------------

Initial Browser extension prototype:-
</> Markdown
1.manifest.json - Browser extension configuration
2.popup.html - Extension popup interface
3.main.ts - Main application logic
4.crypto.ts - Cryptographic operations
5.vault.ts -  Encrypted vault functionality
6.idb-store.ts - IndexedDB persistence
7.validation.ts - Input and data validation
8.errors.ts - Error handling
9.types.ts - TypeScript definitions
10.styles.css - Interface styling
11.scripts/build.mjs - Build process

