This is a project I’ve been working on with AI. I’m not a developer, but essentially, Idensified is intended to be a plug-in that helps everyday users decide when they shouldn’t share their real identifying information.
While studying cybersecurity, I began noticing common web vulnerabilities on websites that ordinary people use every day. It made me realise that most people have very little visibility into the security of the digital environments they interact with.

People trust websites, applications and virtual environments every day, often without knowing what security risks might exist beneath the surface. Some may also assume that GDPR provides a level of technical security protection, when in reality it is a legal framework governing the protection and processing of personal data, not a guarantee that a website is technically secure or free from vulnerabilities.

I started asking myself: how do you address that lack of awareness without creating widespread distrust?

I don't believe making people suspicious of everything online is the answer. Digital infrastructure is fundamental to everyday life, and discouraging people from using it isn't protection.

Existing cybersecurity measures play an essential role in protecting users and identifying threats. However, I saw an opportunity to complement those protections by making technical security information more accessible to the people it could affect.

That became the idea behind IDENSIFED.

I wanted to create a simple browser extension that does the technical work behind the scenes: comprehensively assessing publicly accessible website resources, correlating detected technologies and components against established vulnerability databases, and translating relevant findings into understandable, practical guidance.

Rather than overwhelming users with technical terminology or automatically discouraging them from visiting a website, IDENSIFED aims to give them information they can actually use.

For example, a finding that might otherwise be presented as a technical vulnerability identifier such as CVE-2014-0160 could be translated, where the evidence supports it, into a straightforward recommendation:

*'Heads up — you might want to use an alias here.'*

Users can then choose a **'Want to know why?'** button to see a plain-language explanation of the finding, what it could mean and why the recommendation was made.

The intention isn't to tell people which websites they can or cannot use. It's to help them understand the potential risks associated with sharing identifying information in different digital environments, and give them practical ways to limit unnecessary exposure.

IDENSIFED is about informed trust, not fear. It doesn't replace existing security measures; it builds on the information they help make available and puts a different focus on what ordinary users can do with it.

Because people shouldn't have to understand cybersecurity to make informed decisions about their online identity.

**Don't eliminate trust. Make trust informed.**

I wanted Idensified to help people strengthen their online identity and run background checks on websites, so the playing field is fairer. Many websites use a range of measures to gather data about everyday users; it seems only fair that users should have a similar level of insight and awareness. This could help people understand the potential risks of using the internet while also giving them tools to protect themselves.

I’ve used AI to help sketch out the first version of this project. It’s a work in progress, not a finished security tool. I’m sharing it to invite feedback and contributions from people with different levels of security and web development experience. The core principle is: it informs; it doesn’t restrict. That makes Idensified’s approach clear and keeps its honest—qualities which I think people will respect.
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

- note: I fought with AI to implement the best security possible but there will probably be some mistakes, and ive purposely limited dependencies for better and simpler protections, but also not to fall into the trap of having so many dependencies that updating one could potentially break the whole thing.
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

