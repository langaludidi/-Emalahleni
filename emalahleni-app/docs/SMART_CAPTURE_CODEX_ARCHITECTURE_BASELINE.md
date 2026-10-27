# SC-I01 — Codex / Smart Capture integration architecture assessment

**27 October 2026 — source review only.** Evidence is from the draft `docs/smart-capture-handoff` branch; do not treat this as an assessment of production deployment. This baseline is **implemented and under CI review**, not sponsor-approved.

## Existing Codex application contracts

| Area | Existing source | Smart Capture integration implication |
|---|---|---|
| Main API router | `src/worker.ts` | Smart Capture routes already mounted under `/api/projects/:project/smart-capture/`; the same Worker handles cases, evidence and DoHS. |
| Queue entrypoint | `src/entrypoint.ts` | Smart Capture queue consumer is wired into the app entrypoint, but gated; the separate Neon probe is **not** this consumer. |
| Authentication | `src/worker.ts`, `src/auth.ts` | Actor authentication precedes project routes; role checks and project membership must remain authoritative. |
| Data access | `src/database.ts` | `Database.forActor` executes statements with actor-scoped DB context; no bypass using owner role. |
| Case create/read/update | `src/worker.ts`, `src/contracts.ts` | Existing `applications` table, encrypted `fields_ciphertext`, `DRAFT` workflow, versioned edits. |
| DoHS workflow | `src/department-review.ts`, `src/worker.ts` | Smart Capture must never directly modify section review state, readiness or approval decisions. |
| Evidence | `src/evidence.ts` | Existing scanner, private R2 and evidence APIs remain separate; imported supporting PDFs must not be marked verified. |
| Drive metadata intake | `src/smart-capture-api.ts`, `src/smart-capture-folders.ts` | Approved root → beneficiary folder → PDF discovery; source mapping server-side. |
| OCR page classification | `src/smart-capture-classify.ts` | Document types are hints; unknown/ambiguous page boundaries must fail closed. |
| Officer review | `src/smart-capture-review.ts`, `src/smart-capture-proposal.ts` | Optimistic review version, encrypted proposal, explicitly confirmed fields, one `DRAFT_CREATED` audit on successful commit. |
| Duplicate guard | `src/smart-capture-review.ts`, isolated DB constraints | Same-folder already committed case is rejected; concurrent confirms need DB uniqueness and transaction evidence. |

## Observed API path inventory

All paths are prefixed with `/api/projects/:projectId`. The source router contains:

- `GET /smart-capture/sources` and `GET /smart-capture/imports`.
- `POST /smart-capture/sources/:sourceId/sync`.
- `POST /smart-capture/imports/:importId/process`, `/retry`, `/enqueue`.
- `GET /smart-capture/imports/:importId/proposal`, `GET /smart-capture/imports/:importId/pdf`.
- `PUT /smart-capture/imports/:importId/proposal`, `POST /smart-capture/imports/:importId/confirm`.
- `POST /smart-capture/recover` for authorised recovery.
- Existing `/applications` case list, create, read, save, readiness, DoHS and export endpoints.

These are **code-level route observations**, not evidence that all routes are deployed or work end-to-end.

## Confirmed design boundary

```text
Google Drive beneficiary folders (read-only)
  -> metadata discovery -> versioned import
  -> private PDF quarantine -> malware scan -> OCR proposal
  -> encrypted proposal / human officer correction
  -> project-scoped, version-checked DRAFT creation
  -> existing applications API and DoHS workflow (unchanged)
```

## Findings and required follow-up

| ID | Finding | Priority | Action |
|---|---|---|---|
| A-01 | Canonical `audit_events` and restricted INSERT permissions differ from isolated preview fixture | Critical | Design reviewed canonical migration, not copy synthetic fixture into production |
| A-02 | Queue-to-Neon probe is deployed with flag off; actual read not yet verified | High | Operator-only one-message acceptance on separate synthetic queue |
| A-03 | Full synthetic browser path through review and case reopening is not evidenced | High | Automated UI/API/database acceptance test |
| A-04 | Supporting-document segmentation is advisory and cannot certify evidence | High | Conservative page tests and reviewer confirmation rules |
| A-05 | Document pack >5 MiB and folders with >100 PDFs fail closed | Medium | Design bounded pagination/large-PDF strategy |
| A-06 | No approved real-data privacy/provider processing authorisation | Release blocker | POPIA/DPIA, provider location and retention signoff |
| A-07 | Package install previously reported critical/high vulnerabilities | High | Triage `npm audit` without automatic forced upgrade |
| A-08 | Source code's page hints assumed consistent page numbers | Medium | Added fail-closed classifier and regression tests under SC-I04 |

## Definition of done for SC-I01

- [x] Identify authoritative Codex API, database, case, evidence and DoHS integration boundaries.
- [x] Identify existing Smart Capture route entry points and human confirmation flow.
- [x] Record critical integration risks and distinguish source implementation from deployment evidence.
- [ ] Independent reviewer approval of canonical schema and workflow assumptions.
- [ ] Complete final CI on the integration branch.
- [ ] Confirm deployed runtime parity with existing Codex build; cannot be inferred from branch code.

**Disposition:** SC-I01 technical baseline documented; approval and runtime parity pending. SC-I04 classification safety improvement can proceed in parallel; no production merge.
