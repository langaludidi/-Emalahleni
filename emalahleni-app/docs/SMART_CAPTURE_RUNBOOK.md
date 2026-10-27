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

## 8. Stale import claim reconciliation (SC-015, operator-controlled)

New protected endpoint: `POST /api/projects/:projectId/smart-capture/recover`.
Only active project `ADMIN` or `MANAGER` may invoke it, and both processing feature flags must be enabled. The endpoint checks up to 20 imports claimed for more than 30 minutes in `FETCHING`, `QUARANTINED`, `SCANNING`, or `EXTRACTING`. It atomically marks them `FAILED` with `STALE_CLAIM_REQUIRES_REVIEW`, releases the claim, and returns import UUIDs for manual investigation.

**This is a safety mechanism, not an automatic retry.** The explicit retry endpoint does not allow `STALE_CLAIM_REQUIRES_REVIEW`; a human must investigate partial R2 quarantine, scanner status, provider charges and whether an extraction proposal was committed. `COMMITTING`, `COMMIT_UNCERTAIN`, `COMMITTED`, and `REJECTED` are never altered by this reconciliation.

Remaining integration test: terminate the consumer at each processing stage and verify that a late worker cannot advance a row after the administrator marks it stale; verify source PDF and private quarantine retention policies. Avoid running this endpoint while an unusually long valid scan is still executing; adjust lease/heartbeat design before unattended bulk imports.

## 9. Late-worker fencing limitations (SC-016)

Stage transitions, failure marking and encrypted proposal commit now require the actor to retain an active claim. Once the SC-015 recovery clears `claimed_by` and `claimed_at`, an old worker cannot normally advance its previous state.

**Important remaining race:** actor-only claim ownership is not a unique processing-attempt token. If the *same actor* retries and reclaims an import while an earlier worker is still running, the old worker may see a newly active claim with the same actor. Before production bulk use, add a random per-attempt claim token (or monotonically increasing attempt generation) to every state-changing SQL predicate and an integration test that races an old attempt against a new attempt by the same actor. This is a release blocker, not an acceptable residual risk.

## SC-018 — isolated database security validation (not yet executed)

The read-only SQL checks in `migrations/20261027_smart_capture_security_preflight_READONLY.sql` must return **zero findings** on a synthetic, isolated database after migration review. They inspect the claim token column, FORCE RLS on all three Smart Capture tables, and accidental DELETE grants to the restricted runtime role.

The checks are **necessary but not sufficient**: an authorised reviewer must test two actors from different projects, an inactive membership, a viewer, and an authorised writer against INSERT/UPDATE/SELECT, including direct SQL attempts to bypass HTTP handlers. Review `sc_imports_update` and `sc_proposals_update` carefully: broad project-writer UPDATE policies do not themselves enforce legal state transitions or claim ownership. Those invariants currently rely on server SQL predicates, so a dedicated audited transition-function design remains a production security gate.

Never run these scripts against the existing preview or production branch without explicit environment confirmation. No migrations have been applied as part of this handoff.

## SC-019 — isolated Neon test branch created

Neon project `noisy-pond-49029240`, test branch `br-proud-union-zaded8kk` (`smart-capture-sc018-synthetic-isolated`) was created from synthetic preview parent `br-gentle-lab-zab9t10k` on 2026-10-27. Initial read-only query: database `vectra_preview`, owner role `vectra_preview_owner`, 0 existing Smart Capture tables, 2 project rows. **No migrations were applied.** This branch is not production and is not the preview default.

Before any migration is applied, review all SC draft migrations in dependency order, validate referenced foreign keys, RLS policy coverage and role grants, and obtain explicit approval for applying them to this isolated branch. Test with synthetic actors only. Do not attach Google Drive credentials or process real PDFs.

## SC-020/021 — isolated database integration results (27 October 2026)

**Environment:** Neon preview project `noisy-pond-49029240`, *separate non-default isolated test branch* `br-proud-union-zaded8kk`. Existing preview branch and production were untouched. Test-specific `SET ROLE emalahleni_worker` permission was enabled **on this isolated branch only**; never apply that grant to shared or production environments. All synthetic transaction scenarios used savepoints and rollback. Two synthetic sources and imports remain as inert fixtures.

The four ordered draft schema migrations (SC-003 queue, SC-004 discovery policy, SC-007 proposals, SC-017 attempt fencing) were successfully applied to this isolated branch on 27 October 2026. The SC-020 import transition guard and SC-021 proposal write guard draft migrations were then applied **only there**. This does not authorise or constitute production deployment.

Verified with the actual restricted `emalahleni_worker` role:
- Project A manager sees one Project A import and no Project B imports; Project B manager sees the converse
- Project A auditor can read its project, but its direct write returns zero rows
- Inactive manager and unaffiliated actor see zero imports; Project B manager cannot update Project A import
- Before SC-020, an authorised manager could improperly jump `DISCOVERED → REJECTED`; after SC-020 PostgreSQL rejected that update
- Legitimate `DISCOVERED → FETCHING → QUARANTINED → SCANNING → REJECTED` and claim release succeeded
- Following synthetic `FAILED → DISCOVERED → FETCHING`, an attempt using the old claim token updated zero rows while the new token remained current
- Before extraction, a direct proposal INSERT was rejected; legitimate `EXTRACTING` proposal creation and `NEEDS_REVIEW` revision-1 update succeeded

A role-matrix and state-machine integration test has therefore been performed, but **this is not a production security clearance**. The server continues to use broad project-writer UPDATE grants; token and state triggers are defence-in-depth, not a substitute for dedicated, audited server-only transition functions. Other outstanding release gates include negative proposal UPDATE tests, cross-project insert attempts, atomic confirmation race testing, storage/orphan recovery, real queue integration, runtime secrets and privacy/security approval. No real beneficiary PDFs were processed.

## SC-022 — confirmation parity blockers (isolated branch, 27 October 2026)

The restricted-role synthetic walkthrough reached `NEEDS_REVIEW` and successfully exercised versioned proposal editing. It could **not** create the normal application draft: `emalahleni_worker` is denied `INSERT` on `public.applications`. Read-only `migrations/20261027_smart_capture_commit_parity_READONLY.sql` confirmed three findings on the isolated clone:
1. `AUDIT_EVENTS_TABLE_MISSING` (the synthetic preview database has no `public.audit_events`).
2. `APPLICATION_INSERT_GRANT_MISSING` for the restricted runtime role.
3. `WORKER_LOGIN_DISABLED` for the restricted runtime role.

These are **baseline environment parity findings**, not permission changes made by Smart Capture. Existing non-Smart-Capture draft-creation code also attempts application INSERT and audit-event INSERT, so check the canonical runtime database and deploy migrations before assuming that flow works there. Do not issue blanket grants solely to make the test pass. Prefer an audited, project-scoped draft-creation transaction with least-privilege role permissions, or a reviewed SECURITY DEFINER function with explicit actor/project/role checks and immutable audit recording. Confirm actual production schema and grants separately **with permission**, without altering it.

SC-021 additionally passed a negative test: editing a proposal while its import was still `EXTRACTING` was rejected by the database with `SMART_CAPTURE_PROPOSAL_UPDATE_DENIED`, and the test transaction rolled back. Confirmation, audit insertion and competing-confirmation integration tests remain blocked pending a synthetic environment matching the canonical database permissions.

## SC-023 — additional synthetic abuse and duplicate-case tests (isolated branch)

- Cross-project import insertion as Project A manager into Project B source was rejected by PostgreSQL RLS (not merely by the HTTP layer).
- An unauthorised proposal edit while the import was still `EXTRACTING` was rejected by the SC-021 trigger.
- A complete `NEEDS_REVIEW → COMMITTED` SQL test succeeded *only* within a savepoint using a temporary mock `audit_events` table and temporary worker `INSERT` grant on `applications`. It created an application, linked its import and emitted one audit event; rolling back the savepoint removed the mock, grants and application.
- Two independently processed imports associated with the **same synthetic beneficiary folder** could not both be committed: PostgreSQL raised the `smart_capture_one_case_per_beneficiary_folder` uniqueness violation on the second commit and rolled back the whole test transaction. Follow-up counts were 2 baseline synthetic imports, 0 committed imports and 0 synthetic race-case applications.

No actual Google Drive documents, beneficiary identities or production resources were involved. These tests validate isolated database rules, **not** queue wiring, real PDF scanning, production role grants, RLS under a live application runtime, or deployment authorisation.

## SC-024 — attempt-scoped private storage

Processing now stores each quarantined PDF under `smart-capture/quarantine/<project>/<import>/<attempt-token>/original.pdf` rather than a shared per-import object. The review endpoint validates the exact project/import prefix and a version-4 attempt token before reading from the private R2 bucket; the existing content SHA-256 verification remains. Failed attempts best-effort delete **only their own token-specific object**, preventing a stale attempt from overwriting or deleting a newer attempt's source document. This is code on the draft branch only and has not been deployed.

**Still required:** operator-controlled orphan cleanup of crash-abandoned R2 objects, separate quarantine retention decisions, and an integration test that interrupts two workers while the newer worker uploads its file. Do not activate ingestion before these risks and privacy retention policies are reviewed.

## SC-025 — HTTP route repair

The single-import `POST /api/projects/:projectId/smart-capture/imports/:importId/process` and approved-source `POST /api/projects/:projectId/smart-capture/sources/:sourceId/sync` patterns were normalised to use valid regex literal slash escapes. The existing route test now guards both expressions against malformed duplicated backslashes. This change is on the draft GitHub branch only.

## SC-026 — private quarantine orphan inventory (draft branch only)

Added `src/smart-capture-orphans.ts` with an explicitly **read-only** bounded R2 listing. It requires an active ADMIN/MANAGER project membership, feature flags, and the private R2 binding; lists at most 100 object keys for that project; compares them to project-scoped import `storage_key` references; and returns only aggregate counts (`retained`, `orphanCandidates`, `invalid`, `truncated`). No PDF contents or object keys are returned and no deletion is performed. Synthetic tests exercise a retained object, a stale attempt-specific object, a malformed key, and an unauthorised actor.

The inventory is not exposed through an HTTP route and is not enabled. Before a purge can be implemented, establish retention and legal-hold policy, a minimum orphan age, bounded pagination, an active-worker safety window, an operator approval path, and a two-step dry-run/delete audit trail. An object missing from the current DB reference is a **candidate**, not proof that it can be deleted.

## SC-027 — conservative orphan age and synthetic queue-consumer tests

The read-only orphan inventory now requires an R2 object to have a valid upload timestamp **at least 24 hours old** before counting it as a potential orphan. Recent and undated objects are reported separately as `tooRecent` and never qualify for cleanup. This is not an approved deletion policy; no purge route or delete operation exists.

The queue consumer test suite now covers successful synthetic acknowledgement, malformed message rejection without processing, and duplicate-claim acknowledgement without retry. These are **in-process mock tests**, not a provisioned Cloudflare Queue or end-to-end scanner test. Provisioning an isolated queue, dead-letter queue, bounded retry policy and runtime credentials remains a separate infrastructure gate.

## SC-028 — Cloudflare Queue provision and confirmation permissions

The **disabled test-only** queue fragment is `docs/smart-capture-queue-synthetic.example.jsonc`. It is not merged into `wrangler.jsonc` and is not a complete Worker deployment configuration. To activate an isolated queue, an authorised Cloudflare operator must first create `vectra-smart-capture-synthetic-test` and `vectra-smart-capture-synthetic-test-dlq`, verify the correct Cloudflare account, merge the fragment into a **separate synthetic Worker** configuration, and confirm that the consumer binding and dead-letter routing are supported by the installed Wrangler version. Keep all three Smart Capture flags false until a reviewed test plan is signed off. Do not bind the real beneficiary Drive folder, production secrets, or staging evidence bucket to the test Worker.

The isolated Neon branch `br-proud-union-zaded8kk` was used for synthetic schema/role tests; it is not a canonical runtime environment. The actual restricted-role confirmation parity preflight still reports missing `audit_events`, missing `applications` INSERT permission, and a non-login worker role. A savepoint test temporarily created a mock audit table and INSERT grant and proved the transaction path, then rolled them back. **Do not permanently grant application INSERT or create an audit table just to silence these findings.** First reconcile the canonical deployment migrations, verify the actual production schema through a reviewed read-only inspection, and design an audited least-privilege draft-creation interface.

No Cloudflare Queue resources were provisioned by this PR. No production database, runtime secret, Cloudflare route, or real document was changed.

## SC-029 — observed live synthetic queue evidence, 27 October 2026

Cloudflare account `f887a522ca852a80491c2485853d4363` now has two EU-jurisdiction test resources: `vectra-smart-capture-synthetic-test` and `vectra-smart-capture-synthetic-test-dlq`. The standalone Worker `vectra-smart-capture-test` was deployed to its own `workers.dev` hostname; it is **not** the existing `emalahleni-api-staging` Worker.

User-provided Cloudflare screenshots established:
- Processing queue: 1 synthetic message ingested, 1 acknowledged, 0 retried, backlog 0; Worker logs show `Synthetic queue test processed` around 17:31 SAST.
- Dead-letter queue: 1 message ingested and backlog 1, after a deliberately retried synthetic message. Screenshots establish DLQ delivery, not the precise retry count.
- A later screenshot showed active standalone Worker version `10cf5044` with synthetic-only handler, no intentional DLQ retry branch. This observation does not independently verify the deployed source commit in GitHub.
- No actual application processing occurred: no Drive files, OCR, beneficiary PDFs, Neon application records, or R2 evidence were routed through this Worker.

The source of a credentials-free synthetic Worker is now versioned at `docs/smart-capture-synthetic-worker.ts` for future reproducibility; GitHub CI asserts it cannot reference production Drive/Neon/R2 bindings. The current dashboard Worker was edited manually, so future source-of-truth alignment requires an explicitly authorised standalone test Worker deployment, not a production deploy.

**Security constraint:** The consumer of a production queue must validate a separate versioned message schema and reauthorise each import. Never route schema-1 real Smart Capture messages to the synthetic Worker: it acknowledges and discards non-test payloads by design. Never attach a real producer to this synthetic queue. Keep all Smart Capture processing feature flags off until the canonical DB privilege/audit gaps and document privacy approvals are resolved.

## SC-030 — isolated synthetic audited draft creation validated

On **27 October 2026**, `migrations/20261027_smart_capture_SYNTHETIC_BRANCH_AUDIT_FIXTURE.sql` was applied **only to Neon branch** `br-proud-union-zaded8kk` in project `noisy-pond-49029240`. This is a synthetic fixture, not a deployable canonical migration. It adds `audit_events` with FORCE RLS, narrowly scoped INSERT/SELECT grants, and a restrictive `applications` INSERT policy permitting only active project writers to create incomplete DRAFTs. No UPDATE or DELETE privileges were granted to the restricted runtime role.

Verified inside a transaction as `emalahleni_worker`, actor `synthetic:test:alpha-manager`:
- Complete synthetic processing state transition through `NEEDS_REVIEW`.
- One `applications` row inserted with a synthetic reference; its `smart_capture_imports` record moved to `COMMITTED`; one `DRAFT_CREATED` audit event inserted.
- The transaction was rolled back to a savepoint: no synthetic application, import commitment or audit event persisted.
- A direct application INSERT attempted under actor `synthetic:sc018:alpha-auditor` was **rejected** by `sc030_case_writer_insert` RLS.

The isolated DB still has **no login credentials** for `emalahleni_worker`; database testing uses session-scoped `SET LOCAL ROLE` instead. No DB password was exported, no Cloudflare secret configured, no network connection from the test Worker to Neon exists. Any live application/production migration requires canonical schema reconciliation and a separate security sign-off, rather than installing this synthetic audit fixture in a non-test environment.
