# VectraSA Smart Capture — Integration Delivery Plan and Decision Gates

**Version:** 1.0 | **Date:** 27 October 2026 | **Status:** Working baseline; not approved for production
**Repository:** `langaludidi/-Emalahleni` | **Application:** `emalahleni-app/`
**Integration branch:** `docs/smart-capture-handoff` | **Review:** Draft PR #11
**Live Worker:** `emalahleni-api-staging` — **no modifications without separate approval**
**Data rule:** synthetic-only until written authorisation and security/privacy gates

## 1. Governance and scope

The Codex-built VectraSA application is the system of record for beneficiary cases and DoHS assessment workflow. Smart Capture is an optional intake and officer-assistance module, **not** a separate case management or approval engine. It discovers documents, scans them, extracts tentative fields, and creates a case only after an authorised officer confirms a draft. It never automatically approves a DoHS decision.

**Owner / go-no-go:** project sponsor (user). **Implementation:** Codex/GitHub development workstream. **Technical review:** repository maintainers and designated security reviewer. **Business acceptance:** authorised housing process owner. **Privacy authorisation:** information officer / designated responsible party. Do not presume any reviewer has signed off.

## 2. Non-negotiable controls

- Existing authentication, project membership, RLS, audit, encryption, document scanning, and DoHS state machine remain authoritative.
- Source PDFs remain private. No real beneficiary data in development or external AI testing without authorisation.
- No direct application INSERT by OCR provider or queue; human-reviewed confirmation is the only permitted path.
- Unreadable, conflicting, incomplete or unclassified fields remain **unknown / needs review**, never fabricated.
- Each source PDF revision has a stable import identity; duplicates and concurrent confirms must not create duplicate cases.
- No changes to live `emalahleni-api-staging`, production Neon, or production R2 as part of draft PR #11.
- Every phase must produce a tested artifact and evidence before it can be declared complete.

## 3. Phase register

| Phase | Goal | Evidence / exit criteria | Status |
|---|---|---|---|
| P0 — Baseline | Reconcile current app routes, schema, DoHS transitions, UI and Smart Capture code | Versioned architecture, contract inventory, known gaps, approved scope | **In progress** |
| P1 — Isolated infrastructure | Verify least-privilege Neon, queue, DLQ, audit transaction and secrets | Cloudflare-to-Neon single synthetic read; SQL role denial; logs/metrics | **Partial** |
| P2 — Document pipeline | Safe discovery, revision checks, PDF classification, malware scan, AI extraction and encrypted proposal | Synthetic PDFs, negative-path tests, no invented values | **Partial** |
| P3 — Codex app integration | Officer list, document viewer, corrections, validation, confirmed draft in existing VectraSA case view | Authenticated end-to-end synthetic browser/API test | **Not verified** |
| P4 — Resilience/security | Retry/DLQ, idempotency, cross-project isolation, audit, retention, recovery | Automated tests + reviewed defect register | **Partial** |
| P5 — Release readiness | POPIA/DPIA, processor/location, approvals, backups, rollback, user acceptance | Signed go/no-go checklist; no critical open defects | **Not started** |
| P6 — Pilot and rollout | Approved limited pilot, monitored processing, operational handover | Written authorisation and pilot evidence | **Blocked** |

**Status vocabulary:** `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED_UNVERIFIED`, `VERIFIED_SYNTHETIC`, `APPROVED`, `DEPLOYED`, `BLOCKED`. Code existence is not equivalent to runtime acceptance.

## 4. Immediate work packages (in order)

| ID | Work package | Done when | Dependency |
|---|---|---|---|
| SC-I01 | Codex architecture reconciliation | API/UI/data contracts checked against existing app, gaps recorded | None |
| SC-I02 | Canonical audit schema and runtime privilege design | Reviewed production-compatible migration; isolated tests pass; no broad role grants | SC-I01 |
| SC-I03 | Isolated queue-to-Neon smoke test | Exactly one synthetic message acknowledged, logs verified, DLQ unchanged, flag disabled afterwards | Desktop operator action |
| SC-I04 | Source PDF and supporting-doc classification | Conservative synthetic tests for multi-doc, ambiguous and unsupported scans | SC-I01 |
| SC-I05 | Officer review and draft mapping | Full synthetic UI/API review; no automatic DoHS progression | SC-I02, SC-I04 |
| SC-I06 | Duplicate and recovery controls | Concurrent confirmations, revised PDFs, interrupted jobs, safe retry evidence | SC-I02 |
| SC-I07 | End-to-end synthetic acceptance | Browser + API + DB + audit + queue test results and defect closure | SC-I03–SC-I06 |
| SC-I08 | Privacy and controlled pilot signoff | Written business/security/privacy approvals | SC-I07 |

## 5. Change-control protocol

1. **Scope:** one work package and documented acceptance criteria.
2. **Design:** identify touched code, schema, data sensitivity, backwards compatibility and failure modes.
3. **Implement:** changes only in `docs/smart-capture-handoff` or a reviewed child branch; no secrets or personal data.
4. **Verify:** typecheck, tests, build, negative-path checks, and isolated DB tests as relevant.
5. **Review:** record evidence, defects, limitations, security implications and reviewer decisions.
6. **Release:** merge and deploy only with explicit sponsor authorisation after gates; preserve rollback and audit.

## 6. Evidence ledger (current)

| Evidence | Result | Limitation |
|---|---|---|
| Original Cloudflare synthetic queue smoke test | One message acknowledged, no retry | Not a Neon query |
| Synthetic DLQ test | One message reached dedicated DLQ | Not production processor |
| Isolated Neon draft + audit SQL transaction | Passed; rolled back | Synthetic fixture, not canonical migration |
| Neon restricted probe role | Confirmed no BYPASSRLS/memberships; only synthetic table SELECT | Isolated branch only |
| Standalone Neon probe Worker deployment | Deployed; secret saved by operator | Probe flag disabled; no live SQL read yet |
| Smart Capture PR #11 CI | Earlier runs passed | Re-run on final integration commit required |
| Real beneficiary document pipeline | Not run | Not authorised |

## 7. Decisions needed only at gates

- **Now:** none; continue architecture reconciliation and synthetic tests without computer access.
- **At SC-I03:** desktop operator activates exactly one isolated queue probe, captures masked evidence, disables flag.
- **Before P5:** business owner validates required fields, missing-data rules and approval workflow; privacy/security review required.
- **Before P6:** explicit written approval to merge/deploy and process authorised real data.

## 8. References

- `docs/SMART_CAPTURE_RUNBOOK.md` — technical deployment and test requirements
- `docs/SMART_CAPTURE_SYNTHETIC_NEON_PROBE.md` — isolated connection controls
- `docs/SMART_CAPTURE_NEON_PROBE_ACCEPTANCE.md` — one-message acceptance and rollback
- Draft PR #11 — source changes, CI and review history

**Current work:** SC-I01 source architecture inventory completed in `docs/SMART_CAPTURE_CODEX_ARCHITECTURE_BASELINE.md`, pending independent review and deployed runtime parity. SC-I04 page-number fail-closed fix and tests committed; latest CI pending. Continue SC-I02 canonical audit/privilege design and SC-I04 synthetic document tests without desktop access. Do not present any phase as approved or deployed until supported by evidence.
