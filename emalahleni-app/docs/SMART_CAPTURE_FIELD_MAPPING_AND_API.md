# Smart Capture: field-mapping and secure handoff contract
Status: proposed implementation contract, **not deployed**. Date: 2026-10-27.
Repo: `langaludidi/-Emalahleni`. Source snapshot: `emalahleni-app/src/contracts.ts`, `src/worker.ts`, `src/evidence-contracts.ts`, `wrangler.jsonc` on `main`.
Owner review required for policy, permissions, provider processing and real-data release.

## 1. Operational model

Input: one private Google Drive PDF containing a **single beneficiary's completed handwritten Department of Human Settlements application plus all supporting documents**. The Drive folder itself is not the applicant identity. The spreadsheet is only the initial, one-time migration source and is NOT used for continuing capture.

Output: an **import proposal**, not an approved case. The proposal is verified field-by-field by an authorised operator before it can create an encrypted `DRAFT` via the existing application service. Capture and assessment remain in VectraSA.

Modes:
- Bulk: project-linked Drive folder import/sync; queue each PDF and show exceptions.
- Individual: select exactly one PDF from a permitted Drive folder or approved temporary upload, and use the same pipeline.

Keep project isolation throughout: no cross-project Drive source, import job, R2 object, case or review visibility.

## 2. Existing form schema: exact mapping boundary

Source of truth: `formSchema` in `src/contracts.ts` (strict Zod schema). Initial values are created with `blankForm()`. AI proposal fields never directly become `formSchema` without review.

| Existing field | Candidate source | Mapping/validation | On ambiguity |
|---|---|---|---|
| `applicant.firstNames` | handwritten first name(s), ID supporting document | trim, max 250; compare with ID | review |
| `applicant.surname` | handwritten surname, ID | trim, max 250 | review |
| `applicant.idNumber` | application + identity document | exactly 13 digits if entered; local check-digit/date plausibility only; **not DHA verification** | review |
| `applicant.phone` | application contact | max 30; do not infer or normalise away leading 0 | leave blank/review |
| `applicant.maritalStatus` | tickbox/text | only `'', SINGLE, MARRIED, DIVORCED, WIDOWED` | `''` + review |
| `applicant.spouseName` | form spouse field, marriage certificate | max 250; conditional document check | blank/review |
| `applicant.disability` | explicit tickbox | true/false only after a human-confirmed response; absent != false | mark unresolved |
| `applicant.disaster` | explicit tickbox | same 3-way source interpretation | mark unresolved |
| `applicant.disasterDetails` | handwritten explanation | max 1500 | preserve original in proposal |
| `applicant.propertyOwned` | explicit tickbox | same 3-way source interpretation | mark unresolved |
| `applicant.propertySold` | explicit tickbox | same 3-way source interpretation | mark unresolved |
| `household.incomeSource` | employment / grant / income declarations | only `'', UNEMPLOYED, SOCIAL_GRANT, EMPLOYED, SELF_EMPLOYED, PENSION, OTHER` | `''` + review |
| `household.dependants[0..1]` | dependant table, birth certificates | max two objects `{name, relationship}`, both <=250 | more than two = mapping blocker; never truncate silently |
| `site.*` | field officer survey/site work | **not filled from applicant PDF** unless source and authority explicitly approved | leave defaults and require site capture |

Crucial: handwritten form may contain address, household size, income amount, dates and other questions NOT represented in `formSchema`. Capture these only in the **encrypted extraction proposal** with source page, and flag a product/schema decision. Do not jam them into unrelated fields or drop them.

Crucial: `blankForm()` uses `false` for booleans. That default MUST NOT be interpreted as a negative applicant answer. Proposal uses `true | false | null` (null = unknown); the reviewer resolves relevant booleans before promotion. Similarly, do not silently translate an empty field to a confirmed answer.

## 3. Canonical extraction proposal (internal TypeScript shape; illustrative)

```ts
type TriState = true | false | null;
type ProposalField<T> = {
  rawText?: string; // encrypted; never returned to audit/observability
  value: T | null;
  state: "EXTRACTED" | "UNREADABLE" | "MISSING" | "CONFLICT" | "CONFIRMED";
  source: { page: number; region?: [number, number, number, number] }[];
  confidence?: number; // provider-specific advisory, not verification
};
type DocumentSection = {
  type: "APPLICATION" | "APPLICANT_ID" | "SPOUSE_ID" | "INCOME_PROOF" |
        "BIRTH_CERT" | "MARRIAGE_CERT" | "AFFIDAVIT" | "OTHER" | "UNKNOWN";
  fromPage: number; toPage: number;
  status: "DETECTED" | "UNCERTAIN" | "NOT_FOUND";
};
type ImportProposal = {
  schemaVersion: 1; projectId: string; importId: string;
  file: { driveFileId: string; driveRevision: string | null; sha256: string; pageCount: number };
  fields: Record<string, ProposalField<unknown>>;
  sections: DocumentSection[];
  warnings: { code: string; field?: string; page?: number }[];
  verifiedAt: string | null; verifiedBy: string | null;
};
```

Store private proposals encrypted at rest, including raw OCR strings, extracted personal information and page metadata that can be sensitive. Keep source document encrypted/private in R2, inaccessible through public URLs. Retention for provider intermediate data, rejected imports and logs requires explicit policy.

## 4. Proposed import state machine

```
DISCOVERED -> QUEUED -> FETCHING -> QUARANTINED -> SCANNING -> EXTRACTING
                                                          |           |
                                                          v           v
                                                     FAILED/RETRY  NEEDS_REVIEW
                                                                      |
                                               REJECTED <- HUMAN_REVIEW
                                                                      |
                                                               VERIFIED
                                                                      |
                                                              COMMITTING
                                                              /        \
                                                          COMMITTED  COMMIT_UNCERTAIN
```

Do not assume provider submission or database writes are exactly-once. `COMMIT_UNCERTAIN` means query the existing application and audit history; never blindly resubmit. A new Drive revision creates a new source-version job, and does **not** silently overwrite a previously confirmed application.

Use durable uniqueness for `(project_id, drive_file_id, source_revision_or_hash)` and a separate project-scoped candidate identity check. File ID/hash deduplication does not substitute for beneficiary identity deduplication.

## 5. Database boundaries (proposed, migration only after review)

Prefer 3 new `public` tables with project-scoped RLS and existing actor context:
- `smart_capture_sources`: id, project_id, provider, encrypted folder identifier/config, enabled, created_by, created_at; no public folder listing.
- `smart_capture_imports`: id, project_id, source_id, provider_file_id, revision, sha256, state, storage_key, attempt count, last_error_code, claimed_at/worker, application_id nullable, timestamps; unique source/revision key and safe hash handling.
- `smart_capture_proposals`: import_id, project_id, schema_version, encrypted_payload, reviewed_payload/version or revision, reviewed_by, reviewed_at, updated_at; data encrypted using a separately designed context, not reusing form ciphertext format blindly.

Alternative: store provider source metadata in encrypted service config and immutable import rows only. Implementation must respect current `Database.forActor` / RLS and existing migration conventions. **No migration in this handoff.**

An import proposal is NOT a `public.applications` row until final human confirmation. Once confirmed, use the existing `POST /api/projects/:project/applications` path's application-service logic, with a production-authorised reference rule replacing current `SYN-...` restriction when approved. Do not bypass `encryptForm`, role checks, audit actions, or optimistic versioning. Never write `fields_ciphertext` from the queue worker directly.

## 6. API contract (proposed routes, not current endpoints)

```
GET  /api/projects/:projectId/smart-capture/imports?pageToken=...
POST /api/projects/:projectId/smart-capture/sources/:sourceId/sync
GET  /api/projects/:projectId/smart-capture/imports/:importId
PUT  /api/projects/:projectId/smart-capture/imports/:importId/proposal
POST /api/projects/:projectId/smart-capture/imports/:importId/confirm
POST /api/projects/:projectId/smart-capture/imports/:importId/retry
```

Rules: every route requires existing Auth and active project membership; writes require capture-capable roles. Only authorised service worker may mutate machine states. Confirm endpoint includes expected proposal version, idempotency key and explicit accepted field values; idempotent repeat confirmation returns same `applicationId`. Actor and project must be written to audit. No arbitrary Drive URL inputs or unscoped file downloads. CSRF/origin and rate-limiter protections must be assessed for new mutation paths.

## 7. Security and vendor processing gates

- Google Drive service identity granted read-only access to an approved project folder. Drive file IDs never accepted without validating ancestry/permission against configured source.
- Validate file size, MIME sniffing and signature, page count, PDF parser limits, decompression bombs, malicious content and antivirus freshness **before** cloud AI extraction.
- Original scanner is limited to 5 MiB and OCR to two PDF pages; add a separately bounded multi-page path with a reviewed upper limit, and keep its current limits intact.
- Require written approval for routing personal information to Google Document AI/Gemini, with processing location, subprocessors, cross-border POPIA assessment, encryption, retention and contract terms confirmed.
- No automatic evidence approval, document authenticity assertion, departmental review, submission readiness or approval.
- No payloads, ID numbers, PDF text, sensitive provider outputs or secret values in logs, traces, exception messages or GitHub fixtures.
- No real beneficiary records in development until existing real-data launch gates close and the owner approves use.

## 8. Reviewer UX acceptance

- Import queue shows file status, error code, retry status and duplicate warning without leaking PII to unrelated projects.
- Two-panel review: page-jump to source field, proposed value, conflict reason and manual correction. Confidence is *advisory*.
- Operator may save review in progress, resume, and explicitly accept or reject each unresolved field.
- Supporting document section ranges are editable; do not assert certification or authenticity from OCR.
- When a case is created, UI links to normal VectraSA capture/evidence workflows and clearly labels its draft status.
- Reports separate imported, pending review, committed and failed jobs; count distinct PDFs, not pages.

## 9. Prioritised synthetic acceptance suite

1. Two identically named PDFs with different Drive file IDs -> distinct imports until identity match flags potential duplicate.
2. Same Drive file ID/revision scanned twice -> one import/job.
3. Same file revised after commit -> new import revision requiring operator choice; original draft unchanged.
4. Concurrent confirms -> at most one linked application, on uncertain commit check before retry.
5. Handwriting unreadable / unsupported answer -> NEEDS_REVIEW, nothing fabricated.
6. Two-source ID disagreement -> CONFLICT; local checksum cannot resolve identity.
7. Three dependants -> mapping blocker, no truncation.
8. Missing tickbox -> nullable proposal; not auto-false.
9. Twelve-page PDF and large PDF -> bounded scanning/extraction, no existing 2-page ID reader misuse.
10. Infected PDF / scanner unavailable -> quarantine, no model call, no extraction.
11. Wrong project/role -> 403 without source content disclosure.
12. Saved review draft conflict -> 409 and preserve local pending edits.
13. AI API timeout -> bounded retries, no duplicate case or sensitive diagnostic leaks.
14. Approval states remain unchanged after Smart Capture commit.
15. CI validates existing scanner, case capture, encrypted save/reopen, build, and branch deployment invariants.

## 10. Delivery sequence

SC-001 lock these contracts and source-field mapping; decide source PDF's real question mapping.
SC-002 provision restricted Drive connector and safe discovery.
SC-003 job state, idempotency, scoped RLS and audit.
SC-004 guarded multi-page file intake/scan and private R2.
SC-005 extraction adapter and synthetic handwriting benchmark.
SC-006 independent validation and reviewer UX.
SC-007 human-confirmation link to encrypted draft service.
SC-008 integration, security and regression acceptance.
SC-009 operational restore/retention.
SC-010 controlled production approval only after release gates.

**No changes to application code, production database, provider credentials or deployment are authorised by this document.**
