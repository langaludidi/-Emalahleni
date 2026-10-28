# Smart Capture — parallel-build handoff (SC-001)

Status: design/coordination only. Branch: `docs/smart-capture-handoff`. No production changes.

## Existing architecture, verified 27 Oct 2026
- Next.js 16 static frontend, Cloudflare Worker `emalahleni-api-staging` serves `app.vectrasa.co.za`.
- Neon Postgres/Auth; project-scoped APIs; encrypted application `fields_ciphertext`; Cloudflare R2 evidence.
- Private scanner Cloudflare Container with ClamAV, Tesseract, Poppler.
- Current evidence upload maximum: 5 MiB; ID OCR on PDFs limited to two pages. **Do not reuse for combined application packs without a separate constrained, multi-page pathway.**
- `src/contracts.ts` has strict applicant/household/site form schema; dependants limited to two. Store other extracted source fields outside the approved form, with provenance.
- The repository's `main` is marked synthetic-data development. Do not import real beneficiary PDFs until security, privacy, operational recovery, authority and acceptance gates pass.

## Proposed integration boundary
**Drive API -> Import job -> R2 quarantine -> malware scan -> page classification / handwriting extractor -> structured proposal -> human review -> existing encrypted save API -> existing assessor and DoHS workflows.**

- One PDF is one beneficiary application *pack*. A Drive file ID is a source key, not a beneficiary identity.
- Idempotency: provider file ID + revision/hash + project; separately check project-scoped reference/identity duplication before drafting.
- Extraction must include page numbers, evidence snippets/locations, confidence or review-needed signals, and raw-versus-confirmed status. Do not auto-approve documents or reviews.
- Original PDF immutable and private; if splitting into evidence files, hash and review them through existing safety controls.
- Preserve encryption context and application version/concurrency checks. Do not write `fields_ciphertext` directly from an OCR process.
- Keep field values within strict `formSchema`; do not pretend uncertain booleans are false without explicit confirmation.
- Access to Google Drive and AI provider secrets stays server-side. Never log PII, document contents or model responses.

## Suggested engineering boundaries for concurrent Codex work
1. SC-001: contracts, mapping and security review (this document is advisory).
2. SC-002: Drive credentials and per-project source configuration.
3. SC-003: isolated import state model (source object, revision/hash, error codes, claimed-by, attempts).
4. SC-004: quarantine + scan pathway designed for multi-page PDFs.
5. SC-005: pluggable extraction provider; test with synthetic handwriting.
6. SC-006: deterministic validation and missing/contradictory data.
7. SC-007: authenticated import list/status and review UI.
8. SC-008: use existing application service for encrypted, versioned drafts; no review state promotion.
9. SC-009: CI synthetic fixtures and adversarial access/retry tests.
10. SC-010: read-only launch readiness checklist, POPIA assessment and recovery drill.

## Acceptance tests / invariants
- Malicious or corrupt PDFs fail closed; provider failures never become a passing scan.
- Repeat sync of an unchanged PDF never duplicates beneficiary drafts.
- Two concurrent workers cannot process the same revision twice into two cases.
- Same person across different files is flagged as potential duplicate within project.
- A field that is unreadable/ambiguous remains review-required; original saved data cannot be silently overwritten.
- Cross-project read/write and Drive folder traversal are forbidden.
- Browser cannot call AI provider with credentials or fetch R2 files without authenticated case scope.
- Manual assessor/DoHS approvals are not changed by Smart Capture.
- App tests, scanner CI, domain and deployed synthetic capture/reopen smoke tests pass before release.
- Cloudflare Worker name, `DocumentScanner` binding and R2 evidence bucket preserved.

## Coordination
Do not merge this document branch until the implementation branch has been inspected for overlapping requirements. Treat the existing document `VectraSA_Smart_Capture_Implementation_Specification.md` in the conversation as the longer reference. No AI vendor or production PDF permissions are approved by this handoff.
