# Smart Capture — deployment and acceptance runbook (development only)

**Status:** Not production-ready; no beneficiary document processing authorised.
**Code branch:** `docs/smart-capture-handoff`. **Do not deploy or merge without CI and privacy/security review.**
**Canonical application:** `https://app.vectrasa.co.za`, served by Cloudflare Worker `emalahleni-api-staging`.
Do not replace or rename its existing `DocumentScanner` Durable Object, R2 evidence bucket, Neon Auth configuration, or form encryption key.

## 1. What is implemented on the development branch

- Read-only Google Drive metadata discovery for **individual beneficiary subfolders** of the approved source root, then PDFs inside each subfolder; parent-chain checks at processing time.
- Project-scoped source and import-list API, one-page-per-sync indexing, unique revision identity.
- Source/import/proposal table migrations (DRAFT only, not applied).
- Guarded single-PDF processor: claim -> verify Drive folder/revision -> size/signature/hash -> private R2 quarantine -> existing ClamAV scan -> bounded EU Document AI -> isolated AES-GCM encrypted extraction proposal.
- Authenticated reviewer API: read encrypted proposal, download source PDF after clean processing, edit with optimistic version check, confirm draft with strict mapping and review checks.
- Next.js Smart Capture queue and side-by-side review interface.
- Synthetic unit tests and architecture contracts.

**Not provided:** large-PDF support (>5 MiB), durable background worker queue, automatic retries with leases, reliable full-project paginated reporting, completed supporting-document page segmentation, production-ready applicant PDF model mapping, initial workbook migration, real-data acceptance/backup, operational audit for every Smart Capture mutation, fully verified end-to-end CI/integration/browser test coverage.

## 2. Required runtime secrets and feature flags

All secrets go into **Cloudflare Worker runtime secrets**, not GitHub, browser code, chat, or checked-in files.

| Secret/flag | Purpose |
|---|---|
| `SMART_CAPTURE_ENABLED` | Off by default; enables metadata endpoints only after migration |
| `SMART_CAPTURE_PROCESSING_ENABLED` | Off by default; permits document processing and proposal confirmation |
| `SMART_CAPTURE_DRIVE_CLIENT_EMAIL` | Google service account (restricted to approved project folders) |
| `SMART_CAPTURE_DRIVE_PRIVATE_KEY` | Corresponding private key; preserve PEM newline handling |
| `SMART_CAPTURE_DRIVE_SOURCES_JSON` | Mapping of source UUID to approved Google Drive folder ID |
| `SMART_CAPTURE_AI_CLIENT_EMAIL` | Separate AI project service principal |
| `SMART_CAPTURE_AI_PRIVATE_KEY` | Document AI processing private key |
| `SMART_CAPTURE_AI_PROCESSOR_NAME` | EU-region processor name, e.g. `projects/PROJECT/locations/eu/processors/PROCESSOR` |
| `SMART_CAPTURE_ENCRYPTION_KEY` | Separate base64 32-byte AES-GCM key for proposals |
| Existing `DATABASE_URL`, `FORM_ENCRYPTION_KEY` | Must remain unchanged; Worker restricted database role |
| Existing `SCANNER_TOKEN`, `SCANNER_CONTAINER`, `EVIDENCE_BUCKET` | Preserved original private scanner and storage |

No credentials were provisioned by this branch. Do not grant public Google Drive permissions to overcome access failures. Prefer purpose-specific service identities with minimal project-folder permissions; verify organisation policy and service account restrictions.

## 3. Database migration review, in this exact order

1. `migrations/20261027_smart_capture_queue_DRAFT.sql`
2. `migrations/20261027_smart_capture_discovery_policy_DRAFT.sql`
3. `migrations/20261027_smart_capture_proposals_DRAFT.sql`

Before applying, review on a disposable **schema-only Neon branch**, inspect current `public.projects`, `public.users`, `public.project_memberships` and `public.audit_events` schema, validate the restricted `emalahleni_worker` role, review FORCE RLS, SQL privileges and concurrent confirm behaviour. Run migrations over a **direct Neon connection**, not the pooled HTTP app connection. No automatic production migration.

Source entries require authorised administrative provisioning, including project UUID, source UUID, label, created_by and `enabled`, and must match the secret JSON folder map. Never place the folder ID or service private key in a browser response.

## 4. Test sequence (synthetic fixtures only)

1. `cd emalahleni-app && npm ci && npm run typecheck && npm test && npm run build`.
2. Verify existing capture, evidence, scanner, DoHS and dashboard tests unchanged.
3. Confirm unsigned calls to Smart Capture endpoints return 401; flag disabled returns 503 after authentication.
4. Seed only fictional project, officer, reader and source rows in isolated Neon.
5. Discover beneficiary folders and their PDFs; same PDF twice -> one row; same file changed -> separate version; moving a file outside its approved beneficiary folder must block processing.
6. Different project cannot read another source/import/proposal/PDF.
7. Corrupt/infected PDFs never reach the AI provider. Scanner unavailable -> no proposal.
8. Synthetically generated handwritten PDF: scan, AI output, encrypted proposal, field verification.
9. A third dependant, ambiguous ID or unresolved boolean prevents draft confirmation.
10. Two simultaneous confirmations -> at most one application and one audit event.
11. Verify returned draft reopens via existing encrypted read and remains `DRAFT`; DoHS state unchanged.
12. Recovery test: interrupted download/scan, failed AI, uncertain database write and revised Drive file.
13. Desktop/mobile browser tests for reviewer navigation and focus/keyboard interaction.

## 5. Risks that block rollout

- **Real personal data:** Current application is explicitly synthetic-only. Complete real-data DPIA/POPIA assessment, approved processing location and provider contracts before sending any beneficiary PDF to Google.
- **Current 5 MiB limit:** The existing ClamAV scanner supports up to 5 MiB; a combined application pack larger than that fails closed. Build a bounded larger-pack processing path before bulk import.
- **Handwriting quality:** Do not assume Document AI model quality. Benchmark at least five *authorised* representative scans in an approved environment, using redacted/synthetic equivalents for dev when possible. Tune actual field labels against the approved form.
- **PDF document segmentation:** Current normaliser extracts form fields; it does not yet reliably classify/page-split all supporting evidence. These documents must not be marked verified.
- **Backlog throughput:** Current processing is one operator-triggered PDF per request, not durable Cloudflare Queue processing. Each beneficiary folder is scanned for at most 100 PDFs; folders with more than 100 PDFs fail closed pending paginated support. Required before thousands of automated imports.
- **Legacy duplicates:** Source revision unique constraints prevent repeated file sync; beneficiary identity deduplication across separate files/existing historical cases is not complete.
- **Site and dependant fields:** Site verification cannot be invented; existing app has at most two dependants.
- **Backup/restore:** Neon database, R2 private files and BOTH encryption keys must be recoverable together.
- **CI:** Do not merge without app tests, scanner tests, typecheck, build and synthetic staging acceptance on the final commit.

## 6. Safe rollout gates

Gate A: isolated Neon migration passes, verified restrictive role, no real data.
Gate B: synthetic batch processing and private scanner integration pass.
Gate C: end-to-end reviewer, encrypted draft reopening and duplicate tests pass.
Gate D: POPIA, provider agreements, role approval, retention, incident response and tested recovery signed off.
Gate E: limited authorised live pilot with controlled project, explicit rollback plan and results.
Gate F: production go/no-go and operational monitoring.

Keep `SMART_CAPTURE_ENABLED=false` and `SMART_CAPTURE_PROCESSING_ENABLED=false` until the applicable gates complete. The current repository's existing submission-readiness rules remain provisional and are not altered.

## 7. Cloudflare Queue deployment gate (not provisioned)

The Worker now includes a queue producer (`POST /api/projects/:project/smart-capture/imports/:id/enqueue`) and sequential queue consumer. Both remain disabled unless `SMART_CAPTURE_QUEUE_ENABLED=true` and the dedicated `SMART_CAPTURE_QUEUE` producer binding are provisioned. **Do not set these flags in the existing live Worker.** A queue resource and consumer subscription must first be created by an authorised Cloudflare operator and tested on a disposable Worker environment, not the production domain.

Example bindings to add **only in the isolated test environment** after the queue exists:

```json
"queues": {
  "producers": [{"binding": "SMART_CAPTURE_QUEUE", "queue": "vectrasa-smart-capture-test"}],
  "consumers": [{"queue": "vectrasa-smart-capture-test", "max_batch_size": 1, "max_batch_timeout": 5, "max_retries": 0, "dead_letter_queue": "vectrasa-smart-capture-dlq-test"}]
}
```

This example is not added to the live `wrangler.jsonc` because creating a queue, DLQ, and permissions requires separate operational approval. Messages contain only import UUID, project UUID and the authenticated initiating actor. A duplicate message is protected by the existing atomic `DISCOVERED -> FETCHING` claim. Sequential consumer processing limits per-invocation concurrency; a separate Cloudflare consumer concurrency limit of **one** must also be set in the test environment. Failed jobs are stored as `FAILED` and recovered through explicit, bounded operator retry, not automatic queue replay.

**Remaining blocker:** queue delivery acknowledgment and crash recovery need end-to-end tests, including consumer termination between external provider call and database state update. Do not enable unattended bulk processing until an approved lease/reconciler handles stale `FETCHING`, `SCANNING` and `EXTRACTING` states without repeating ambiguous external work.
