# Emalahleni beneficiary assurance — development build

This build implements the four-step verification form, conditional evidence requirements, encrypted draft storage, project-scoped authenticated API access, version checks, private evidence upload and scanning controls, assessor review, and the DoHS section workspace.

It is a synthetic-data development build, not a production release. Authenticated synthetic case access is enabled when the required runtime secrets are present. Document uploads remain disabled. Readiness rules are provisional and never approve submission readiness.

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

## Capture navigation

The capture toolbar provides **Home**, **New form**, **Save draft** for connected captures, and **Log out** when signed in. Home keeps the current form in this tab and offers **Resume form**; it does not save automatically. New form clears all capture sections, the case reference and the active draft while retaining the selected project and its saved drafts. Starting over, changing project/workspace, opening another draft or logging out requires confirmation when the current form has unsaved changes. Save successfully before leaving if those changes must be retained. Saved drafts can be reopened from the home workspace.

## Deployment

The existing `emalahleni-api-staging` Worker is deployed at https://emalahleni-api-staging.ludidil.workers.dev. Cloudflare Workers Builds connects this repository's `main` branch with root directory `emalahleni-app`, build command `npm run build` and deploy command `npm run deploy`. `.node-version` selects Node.js 24. `wrangler.jsonc` retains the Worker and private `emalahleni-evidence-staging` R2 bucket names.

On 14 October 2026, the first connected Cloudflare build succeeded, the operator confirmed the preview rendered in their browser and reported adding `DATABASE_URL`, `FORM_ENCRYPTION_KEY` and `SCANNER_TOKEN` as runtime secrets. The deployed fixed-key `/storage-probe` returned `service: R2`, `status: reachable`, `syntheticProbeObjectPresent: false` and `writeEnabled: false`. This verifies R2 HEAD access; it does not verify uploads, scanning, login or database credentials. Case access and document uploads were disabled for that first deployment.

Configure `DATABASE_URL` as a Worker secret using the restricted `emalahleni_worker` account. Its prepared secret is outside this source package. Configure `FORM_ENCRYPTION_KEY` as a separate secret containing a base64-encoded 32-byte AES key. Preserve that key across deployments; losing it makes saved forms unreadable. Never include either secret in browser code or commit them.

`ENABLE_CASE_API=true` enables the authenticated case API after configuration. Assign identities to project memberships administratively; signing in does not grant access. The Neon Auth issuer and JWKS are configured for the existing staging branch, and the Worker origin has been added to that branch's trusted domains. The staging sign-in screen handles unverified-email errors, lets the user explicitly request an email verification code, and verifies that code through Neon Auth. **Forgot password** also lets the user request a password-reset code and choose a new password inside the app; no downloaded password file is needed. Reset codes and email-verification codes have separate purposes. Browser sign-in and session restoration still require live verification.

## Gate-two preparation

The staging database contains a labelled synthetic project and an encrypted draft for the capture check. The operator has `OFFICER` access to that project. Separate reserved-domain test identities cover `AUDITOR`, `DOHS_REVIEWER`, another project and no membership; their email verification remains pending. Signing in does not create memberships or grant access.

The prepared Worker database credential authenticated as `emalahleni_worker`, with no superuser, role-creation or RLS-bypass privileges. Staging probes through the same restricted role passed project isolation, no project visibility for an unassigned identity, encrypted create/save, stale-version rejection, read-only auditor behavior using the API's writer predicate, and other-project/unassigned read/write denial. Probe audit metadata is labelled `GATE2_DATABASE_PROBE`. These are database probes, not HTTP requests authenticated by live JWTs; the browser sign-in, token verification, saved-case reload and sign-out journey remains pending.

`wrangler.jsonc` enables the authenticated case API for the synthetic staging test while retaining `ENABLE_DOCUMENT_UPLOADS=false`. Local type checks and all 17 tests pass. The browser harness covers email verification and password recovery with mocked endpoints, including incorrect codes, mismatched passwords, clearing recovery fields and changing email addresses. These checks do not prove real email delivery or a successful live password reset.

## Documents and scanner

`ENABLE_DOCUMENT_UPLOADS=true` also requires a private `SCANNER` service binding, `SCANNER_TOKEN`, and the R2 binding. Without them, uploads fail closed. Keep uploads disabled until the complete deployed flow is verified.

The authenticated evidence register reports upload availability using the same configuration check as the upload endpoints. The form disables file selection and upload until availability is confirmed, distinguishes a selected file from a recorded document, and shows upload outcomes next to the button. Failed register loads are not reported as an empty register. ID details are entered manually; ID OCR is not implemented. The staging database check on 15 October found no recorded evidence; the deployed scanner remains outstanding.

The API permits PDF, JPEG and PNG files up to 5 MB. An authenticated upload intent binds the file's size, SHA-256, type, case and uploader, with a 15-minute expiry. Bytes must match the declaration and file signature. A fixed generated storage key prevents caller-selected object paths. A scanner failure leaves the object quarantined; an infected object cannot be downloaded. A clean scan moves it to assessor review, not automatic approval. Only an assessor or admin can record an evidence decision. ID certification is required for applicant and spouse ID copies.

`scanner/server.mjs` adapts HTTP requests to ClamAV's INSTREAM protocol. Run it behind a private TLS gateway with `SCANNER_TOKEN` (at least 32 characters), `CLAMAV_HOST` and `CLAMAV_PORT`. `scanner/bridge.ts` is a private Worker service adapter using `SCANNER_ORIGIN` and `SCANNER_TOKEN`. Deploy the bridge with public routes disabled, then bind it to the application as `SCANNER`. No live ClamAV service has been deployed or tested. Scanner availability and signature updates need operational ownership.

## Review ownership

The DoHS workspace covers Pages 2 and 3 and Sections C, E, F and H. Only a project-assigned DoHS reviewer may write these reviews. Updates carry the last review timestamp to reject stale decisions. Applicant-form saves cannot modify departmental fields.

## Validation and limits

Seventeen local automated tests passed. Checks cover conditional requirements, calendar-month expiry, SASSA exemptions, dependant policy review, encryption binding, token verification, restricted database credentials, file declaration validation, and fail-closed scanner results.

The prior case integration run passed on a populated isolated Neon branch: encrypted create/read/save, cross-project read/write denial, stale-version conflict, auditor write denial, departmental ownership, actor reset and audit events. The new evidence integration harness uses real PostgreSQL isolation and explicit R2/scanner doubles. The document run passed upload integrity, replay protection, cross-project access denial, assessor/certification gates, clean-file retrieval, scanner-outage quarantine/retry and infected-file denial before exposing a DoHS timestamp precision conflict. The API now preserves the database timestamp's microseconds in its concurrency token. A database round-trip probe verifies exact precision, and the full isolated-branch rerun passed, including valid DoHS updates, stale-update rejection, export snapshot isolation and fingerprint changes after edits. Do not treat these doubles as verification of live Cloudflare storage or ClamAV.

GitHub browser checks passed at 1440 × 1000 and 390 × 844 in Chromium, including the four-step form, conditional evidence, readiness responses, no horizontal overflow, no script errors and generated PDF downloads. Run: https://github.com/langaludidi/-Emalahleni/actions/runs/38540486238. This is not verification on a physical iPhone.

Before processing real beneficiary information: reconcile the conditional rules with the original workbook and DoHS decisions; complete deployed login, storage, scanner and review tests; test populated role/project isolation for the complete workflow; establish retention and cross-border safeguards. OCR for printed image overlays, offline operation, authoritative submission approval and notifications remain outstanding. Embedded photo metadata and draft PDF generation are implemented as described below.

## Photo metadata and PDF features

The site step can read embedded JPEG/PNG GPS and camera dates with exifr. Extraction happens in the browser and proposes values without uploading the file. Applying a proposal resets confirmation; a field officer must check the source image. EXIF-based values carry a file hash, and readiness requires the linked verified photograph to match it. Editing proposed GPS/date values switches to manual entry. A date printed onto an image requires manual entry or a future OCR integration. Camera dates preserve the recorded calendar date; unknown timezones are shown explicitly.

Verification summaries use react-pdf. Preview summaries are marked unsaved; recorded-case summaries and evidence packs are marked draft and never imply submission approval. Export snapshots are read consistently from the database and use the current backend rules. pdf-lib combines only verified, clean evidence, checks downloaded hashes, and rechecks the case fingerprint before completing the pack. Packs are limited to 20 evidence documents, 25 MB and 200 pages. PDF form values are flattened and interactive annotations omitted from copies; original stored evidence is unchanged.

See THIRD_PARTY_LICENSES.md for MIT notices. GitHub's `Emalahleni build and browser checks` workflow runs type checks, tests, a dry-run build and desktop/mobile Chromium journeys. The browser journey also downloads a generated verification summary. The version 0.2 browser run passed; this is not a test on a physical iPhone.
