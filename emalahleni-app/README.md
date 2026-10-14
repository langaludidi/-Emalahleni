# Emalahleni beneficiary assurance — development build

This build implements the four-step verification form, conditional evidence requirements, encrypted draft storage, project-scoped authenticated API access, version checks, private evidence upload and scanning controls, assessor review, and the DoHS section workspace.

It is a synthetic-data development build, not a production release. Case access and document uploads are disabled by default. Readiness rules are provisional and never approve submission readiness.

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

## Deployment

The target is the existing `emalahleni-api-staging` Worker and private `emalahleni-evidence-staging` R2 bucket. `wrangler.jsonc` retains these names. An authenticated Cloudflare connection is required to deploy; none is available in this session.

Configure `DATABASE_URL` as a Worker secret using the restricted `emalahleni_worker` account. Its prepared secret is outside this source package. Configure `FORM_ENCRYPTION_KEY` as a separate secret containing a base64-encoded 32-byte AES key. Preserve that key across deployments; losing it makes saved forms unreadable. Never include either secret in browser code or commit them.

`ENABLE_CASE_API=true` enables the authenticated case API after configuration. Assign identities to project memberships administratively; signing in does not grant access. The Neon Auth issuer and JWKS are configured for the existing staging branch, and the Worker origin has been added to that branch's trusted domains. Actual user login remains unverified.

## Documents and scanner

`ENABLE_DOCUMENT_UPLOADS=true` also requires a private `SCANNER` service binding, `SCANNER_TOKEN`, and the R2 binding. Without them, uploads fail closed. Keep uploads disabled until the complete deployed flow is verified.

The API permits PDF, JPEG and PNG files up to 5 MB. An authenticated upload intent binds the file's size, SHA-256, type, case and uploader, with a 15-minute expiry. Bytes must match the declaration and file signature. A fixed generated storage key prevents caller-selected object paths. A scanner failure leaves the object quarantined; an infected object cannot be downloaded. A clean scan moves it to assessor review, not automatic approval. Only an assessor or admin can record an evidence decision. ID certification is required for applicant and spouse ID copies.

`scanner/server.mjs` adapts HTTP requests to ClamAV's INSTREAM protocol. Run it behind a private TLS gateway with `SCANNER_TOKEN` (at least 32 characters), `CLAMAV_HOST` and `CLAMAV_PORT`. `scanner/bridge.ts` is a private Worker service adapter using `SCANNER_ORIGIN` and `SCANNER_TOKEN`. Deploy the bridge with public routes disabled, then bind it to the application as `SCANNER`. No live ClamAV service has been deployed or tested. Scanner availability and signature updates need operational ownership.

## Review ownership

The DoHS workspace covers Pages 2 and 3 and Sections C, E, F and H. Only a project-assigned DoHS reviewer may write these reviews. Updates carry the last review timestamp to reject stale decisions. Applicant-form saves cannot modify departmental fields.

## Validation and limits

Local automated checks cover conditional requirements, calendar-month expiry, SASSA exemptions, dependant policy review, encryption binding, token verification, restricted database credentials, file declaration validation, and fail-closed scanner results.

The prior case integration run passed on a populated isolated Neon branch: encrypted create/read/save, cross-project read/write denial, stale-version conflict, auditor write denial, departmental ownership, actor reset and audit events. The new evidence integration harness uses real PostgreSQL isolation and explicit R2/scanner doubles. The document run passed upload integrity, replay protection, cross-project access denial, assessor/certification gates, clean-file retrieval, scanner-outage quarantine/retry and infected-file denial before exposing a DoHS timestamp precision conflict. The API now preserves the database timestamp's microseconds in its concurrency token. A database round-trip probe verifies exact precision; the complete integration rerun remains pending. Do not treat these doubles as verification of live Cloudflare storage or ClamAV.

Browser checks at desktop and phone widths remain pending; the local browser launch is blocked by execution sandbox socket permissions. The source compiles and static assets have been generated, but this is not verification on an actual iPhone.

Before processing real beneficiary information: reconcile the conditional rules with the original workbook and DoHS decisions; complete deployed login, storage, scanner and review tests; test populated role/project isolation for the complete workflow; establish retention and cross-border safeguards. OCR/photo-parameter extraction, offline operation, submission-pack generation and notifications are not implemented in this recovered build.
