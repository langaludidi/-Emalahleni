# Vectra Assure — development build

Vectra Assure is a platform by **Vectra Solutions** for evidence management, beneficiary verification and project readiness across projects. The product branding is independent of project names. Existing GitHub, Vercel, Cloudflare, database, storage and package identifiers retain their original names; saved data and encryption contexts are unchanged.

Brand assets are in `web/public/brand/`: the horizontal logo and square app icon follow the approved Vectra Assure brand sheet. The interface uses navy `#0A2540`, teal `#00B4A6`, coral `#FF6B5B`, light grey `#E8EEF4` and off white `#F8FAFC`. Plus Jakarta Sans is self-hosted in `web/public/fonts/` with its SIL Open Font License. Primary controls use navy for readable contrast; teal and coral provide accents.

This build implements the four-step verification form, conditional evidence requirements, encrypted draft storage, project-scoped authenticated API access, version checks, private evidence upload and scanning controls, assessor review, and the DoHS section workspace.

The app is available at **https://app.vectrasa.co.za**, with workers.dev retained as a fallback. It remains a **synthetic-data development build**. Authenticated capture, uploads, private scanning and ID reading are enabled. Live synthetic stored-upload/scan/read checks passed on 19 October 2026; the deployed ID confirmation/save/full-reload/reopen browser journey passed on 20 October. The temporary diagnostic account and its project membership were disabled afterward. Readiness rules remain provisional and never approve submission readiness.

The custom domain passed DNS, certificate-verified HTTPS, health, private API rejection and exact credentialed Auth-origin checks on 26 October. Account-owner acceptance on this new browser origin is a separate remaining check. The launch gates below distinguish technical verification from the remaining rollout work.

## Run locally

Use Node.js 24 or newer:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

Open http://localhost:8787. The preview form works without credentials. Preview entries stay in memory and disappear when the tab closes. The frontend is a static Next.js export; the API runs in the Cloudflare Worker on the same origin.

## Workflow and domain operations

Use [WORKFLOWS.md](WORKFLOWS.md) for capture, evidence, assessor/DoHS handoffs, version conflicts and uncertain-write recovery. The connected platform domain is `app.vectrasa.co.za`; [DOMAIN_SETUP.md](DOMAIN_SETUP.md) records its configuration and mail DNS preservation. Cloudflare's zone and native Worker custom domain are active. The root domain remains available for Vectra Solutions, and the existing workers.dev address remains available.

## Capture navigation

The capture toolbar provides **Home**, **New form**, **Save draft** for connected captures, and **Log out** when signed in. Home keeps the current form in this tab and offers **Resume form**; it does not save automatically. New form clears all capture sections, the case reference and the active draft while retaining the selected project and its saved drafts. Starting over, changing project/workspace, opening another draft or logging out requires confirmation when the current form has unsaved changes. Save successfully before leaving if those changes must be retained. Saved drafts can be reopened from the home workspace.

## Deployment

The existing `emalahleni-api-staging` Worker serves https://app.vectrasa.co.za and https://emalahleni-api-staging.ludidil.workers.dev. Cloudflare Workers Builds connects this repository's `main` branch with root directory `emalahleni-app`, build command `npm run build` and deploy command `npm run deploy`. `.node-version` selects Node.js 24. `wrangler.jsonc` declares the app custom domain and preserves the existing Worker, private scanner and `emalahleni-evidence-staging` R2 bucket names. The root website and mail records remain DNS only in Cloudflare; the registrar's optional Premium DNS service is unused.

Configure `DATABASE_URL` as a Worker secret using the restricted `emalahleni_worker` account. Its prepared secret is outside this source package. Configure `FORM_ENCRYPTION_KEY` as a separate secret containing a base64-encoded 32-byte AES key. Preserve that key across deployments; losing it makes saved forms unreadable. Never include either secret in browser code or commit them.

`ENABLE_CASE_API=true` enables the authenticated case API after configuration. Assign identities to project memberships administratively; signing in does not grant access. The Neon Auth issuer and JWKS are configured for the existing staging branch, and the Worker origin has been added to that branch's trusted domains. The staging sign-in screen handles unverified-email errors, lets the user explicitly request an email verification code, and verifies that code through Neon Auth. **Forgot password** also lets the user request a password-reset code and choose a new password inside the app; no downloaded password file is needed. Reset codes and email-verification codes have separate purposes. The operator reported successful live sign-in and saving a test draft; automated auth/browser tests remain separate evidence.

## Authentication and project isolation

The staging preparation used labelled synthetic projects, encrypted drafts, an operator with `OFFICER` membership and reserved-domain identities for auditor, DoHS, another-project and unassigned checks. Current test-user verification and assigned roles must be confirmed by the project administrator for deployed multi-role acceptance. Signing in does not create memberships or grant access.

The prepared Worker database credential authenticated as `emalahleni_worker`, with no superuser, role-creation or RLS-bypass privileges. Staging probes through the same restricted role passed project isolation, no project visibility for an unassigned identity, encrypted create/save, stale-version rejection, read-only auditor behavior using the API's writer predicate, and other-project/unassigned read/write denial. Probe audit metadata is labelled `GATE2_DATABASE_PROBE`. These are database probes, not HTTP requests authenticated by live JWTs. The operator separately reported successful sign-in and draft saving in the live app.

`wrangler.jsonc` enables the authenticated case API, uploads and ID reading for synthetic acceptance. The 26 October code acceptance baseline passed 42 application tests, type/build validation, PostgreSQL upload-concurrency checks, private scanner checks and desktop/mobile browser journeys. Browser verification and recovery use mocked endpoints, including incorrect codes, mismatched passwords, clearing recovery fields and changing email addresses. These checks do not prove email delivery or a personal password reset.

## Documents and scanner

`ENABLE_DOCUMENT_UPLOADS=true` also requires the private `SCANNER_CONTAINER` binding, `SCANNER_TOKEN`, and the R2 binding. The production entrypoint adapts that Container to the API's internal `SCANNER` interface; no scanner HTTP route is exposed publicly. Without them, uploads fail closed. The private health/scan/OCR probe must pass before enabling controlled synthetic upload acceptance; passing that probe does not prove the stored-file workflow.

The authenticated evidence register uses the same configuration checks as the upload and ID-reading endpoints. It disables upload until availability is confirmed, distinguishes selected files from recorded documents, and reports outcomes beside the action. A failed register is not reported as empty. Separate live acceptance on 19–20 October used actual R2 bytes, ClamAV, OCR, authentication and database writes. The deployed browser required confirmation before applying ID suggestions, then saved and reopened the case with the selected fields retained. The evidence stayed clean and pending assessor review.

The API permits PDF, JPEG and PNG files up to 5 MB. An authenticated upload intent binds the file's size, SHA-256, type, case and uploader, with a 15-minute expiry. Bytes must match the declaration and file signature. A fixed generated storage key prevents caller-selected object paths. A scanner failure leaves the object quarantined; an infected object cannot be downloaded. Failed uploads/scans return only fixed operational reason codes, and Retry scan reports the actual result rather than treating a completed request as a successful scan. Provider messages and document content never become diagnostic responses. A clean scan moves it to assessor review, not automatic approval. Only an assessor or admin can record an evidence decision. ID certification is required for applicant and spouse ID copies.

`scanner/server.mjs` adapts private HTTP requests to ClamAV's INSTREAM protocol. The scanner directory packages ClamAV, Tesseract and Poppler in a Cloudflare Container owned by the app Worker's `DocumentScanner` class. Only `SCANNER_TOKEN` reaches the Container; database and encryption secrets stay in the app Worker. Local OCR checks use synthetic PDF/image fixtures; actual container/ClamAV checks run in the separate scanner CI workflow. Cloud deployment and live acceptance remain distinct. Scanner availability and signature updates need operational ownership.

## Review ownership

The DoHS workspace covers Pages 2 and 3 and Sections C, E, F and H. Only a project-assigned DoHS reviewer may write these reviews. Updates carry the last review timestamp to reject stale decisions. Applicant-form saves cannot modify departmental fields.

## ID reading and private service deployment

`npm run deploy` deploys one canonical configuration: the app, its static assets, and its private scanner Container on `emalahleni-api-staging`. The existing `DocumentScanner` class, `SCANNER_CONTAINER` namespace and `emalahleni-scanner-staging-documentscanner` application name are preserved. Workers Builds scopes deployments to its connected Worker; deploying another named Worker from that build caused the 15 October failure and is no longer supported. Runtime secrets are preserved, not generated or rotated by deployment. `workers_dev=true` restores the app URL after the failed scanner-only deployment. Upload and ID-reading flags are enabled for controlled synthetic testing following the passed private service check. See [scanner/DEPLOYMENT.md](scanner/DEPLOYMENT.md).

For an operator with a saved staging case, **Check document service** uses a fixed synthetic PDF to check private service readiness, clean scanning, hashes and readable ID details without storing a document. That live probe and the separate stored-file upload/read/save/reopen acceptance passed. Flags remain enabled for controlled synthetic testing. A sample is available at `/setup/synthetic-id.pdf`. A successful build or service probe alone does not establish a future deployment's stored-file acceptance.

The private ID reader only accepts a current clean applicant-ID record and a permitted project writer. It rechecks stored and scanner hashes and current document/project access before returning suggestions. Raw OCR text is neither returned to the browser nor saved in audit logs. Reading proposes labelled first names, surname and a checksum/date-checked South African ID number, with a birth-date hint; it does not authenticate a person or verify a document. The operator edits/selects suggestions and confirms them against the original before applying. Existing form fields stay unchanged unless selected. Saving uses the existing encrypted draft/version flow.

## Request protection and recovery

The staging Worker uses native Cloudflare rate-limit bindings: 120 API requests per minute per edge-supplied IP, 30 mutations per minute per authenticated actor, and 12 document upload/scan/read/service-check operations per minute per actor. These are per Cloudflare location, not a global billing or exactly-once guarantee. Hashed keys avoid placing raw user identities or addresses in limiter keys. Rejections use 429, `Retry-After: 60` and `no-store`; unavailable protection fails closed when `ENABLE_API_RATE_LIMITS=true`. Static assets and health checks are excluded. These controls do not replace Neon Auth's sign-in protections.

Only one request can transition an evidence record from pending upload to pending scan. Overlapping and completed claims are rejected. A completed R2 error releases an unfinished matching claim; Worker interruption between storage and database completion still requires operational recovery and is not a distributed transaction guarantee. Private malware scans, which do not write documents, retry selected transient failures up to three times inside one 120-second budget. Increasing jittered waits respect `Retry-After`. Credential, integrity, invalid response, infection and stale-signature outcomes are not automatically retried. Exhausted failures remain quarantined, with a fixed diagnostic code shown beside the affected file after Retry scan.

Each database transaction sets local statement and lock limits (15 and 5 seconds) and a 20-second HTTP deadline. Database writes are not automatically retried after an uncertain commit. CI checks application branches before publication; disposable PostgreSQL verifies the upload claim under concurrent row locks. Native workerd checks use local R2 and the real scanner container, with SQL explicitly doubled. Separate live synthetic stored-upload acceptance passed on 19 October; local doubles do not replace deployed workflow checks.

## Validation and limits

Local automated checks cover the core application and ID-reading boundaries. Checks cover conditional requirements, calendar-month expiry, SASSA exemptions, dependant policy review, encryption binding, token verification, restricted database credentials, file declaration validation, and fail-closed scanner results.

The prior case integration run passed on a populated isolated Neon branch: encrypted create/read/save, cross-project read/write denial, stale-version conflict, auditor write denial, departmental ownership, actor reset and audit events. The new evidence integration harness uses real PostgreSQL isolation and explicit R2/scanner doubles. The document run passed upload integrity, replay protection, cross-project access denial, assessor/certification gates, clean-file retrieval, scanner-outage quarantine/retry and infected-file denial before exposing a DoHS timestamp precision conflict. The API now preserves the database timestamp's microseconds in its concurrency token. A database round-trip probe verifies exact precision, and the full isolated-branch rerun passed, including valid DoHS updates, stale-update rejection, export snapshot isolation and fingerprint changes after edits. Do not treat these doubles as verification of live Cloudflare storage or ClamAV.

The [26 October app CI](https://github.com/langaludidi/-Emalahleni/actions/runs/40283721875) passed desktop (1440 × 1000) and mobile (390 × 844) Chromium journeys, including capture/Home/Resume, saved drafts, ID confirmation, retained pending input, register failures, assessor certification and departmental concurrency recovery. The [scanner CI](https://github.com/langaludidi/-Emalahleni/actions/runs/40283721803) passed the real image, ClamAV and Worker/Container checks. Browser authentication and document responses in app CI are controlled fixtures; they do not prove a personal sign-in on the new domain or behavior on every physical phone.

## Launch gates

The domain and HTTPS setup are complete. Real beneficiary processing and departmental submission remain outside the current synthetic-only release. The following work still needs evidence; an unverified control is not necessarily an absent control.

| Gate | Evidence still needed | Responsible party |
| --- | --- | --- |
| New-domain account acceptance | Sign in at the new address, open a saved synthetic case, save an edit and reopen it. Existing workers.dev sessions do not transfer. | Account owner |
| Live role and project handoffs | Assigned capture, assessor, DoHS and auditor test users complete the saved-case/evidence workflow and confirm other-project/unassigned access is denied. Database and fixture tests already pass; this is deployed multi-role acceptance. | Project administrator and assigned reviewers |
| Business rules and submission authority | Reconcile the original workbook, conditional document rules, exceptions and DoHS responsibilities; record who may approve submission. Rules remain provisional and submission readiness stays false. | Project/policy owner and authorised departmental owner |
| Real-data handling | Confirm the approved purpose, access assignments, retention/deletion process and hosting/cross-border safeguards before implementing a real-data release. | Data owner with the relevant privacy/legal reviewer |
| Recovery and operations | Demonstrate encrypted-form and evidence recovery with the retained encryption key; establish scanner/signature monitoring, incident ownership and rollback instructions. These operational acceptance checks are not established by a build. | Technical operator and service owner |

Use the synthetic workflow for acceptance. Keep the disabled diagnostic account disabled; manage test identities and project memberships through the approved administrative process. If domain email is used, its owner must verify send/receive; matching DNS records does not prove mail delivery.

Printed image-overlay OCR, offline capture and notifications are unimplemented capabilities to prioritise separately. Embedded photo metadata and draft PDF generation are implemented below.

## Photo metadata and PDF features

The site step can read embedded JPEG/PNG GPS and camera dates with exifr. Extraction happens in the browser and proposes values without uploading the file. Applying a proposal resets confirmation; a field officer must check the source image. EXIF-based values carry a file hash, and readiness requires the linked verified photograph to match it. Editing proposed GPS/date values switches to manual entry. A date printed onto an image requires manual entry or a future OCR integration. Camera dates preserve the recorded calendar date; unknown timezones are shown explicitly.

Verification summaries use react-pdf. Preview summaries are marked unsaved; recorded-case summaries and evidence packs are marked draft and never imply submission approval. Export snapshots are read consistently from the database and use the current backend rules. pdf-lib combines only verified, clean evidence, checks downloaded hashes, and rechecks the case fingerprint before completing the pack. Packs are limited to 20 evidence documents, 25 MB and 200 pages. PDF form values are flattened and interactive annotations omitted from copies; original stored evidence is unchanged.

See THIRD_PARTY_LICENSES.md for MIT notices. GitHub's `Emalahleni build and browser checks` workflow runs type checks, tests, a dry-run build and desktop/mobile Chromium journeys, including a generated verification-summary download. Release evidence and its limits are described above.

