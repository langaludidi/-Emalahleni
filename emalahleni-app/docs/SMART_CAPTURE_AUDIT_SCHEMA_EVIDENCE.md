# SC-I02 — Canonical audit and application privileges: isolated evidence

**Date:** 27 October 2026. **Environment:** isolated Neon project `noisy-pond-49029240`, branch `br-proud-union-zaded8kk`, database `vectra_preview`. **No production query or mutation was performed.**

## Verified with read-only SQL

- `public.applications`, `public.audit_events`, `public.smart_capture_imports` and `public.smart_capture_proposals` all report `relrowsecurity=true` and `relforcerowsecurity=true`.
- The isolated `audit_events` table has `id uuid`, `project_id uuid`, `actor_id text`, `action text`, `metadata jsonb` and `created_at timestamptz`, all non-nullable.
- The isolated `applications` table has `id`, `organisation_id`, `project_id`, `reference`, `fields_ciphertext`, `version`, `workflow_status`, `dohs_complete`, and related timestamps/optional metadata. These columns are **observed**, not a guarantee of production parity.
- The isolated application policies include `scope_applications` (permissive, public), `migration_owner_applications` (permissive, preview owner), and `sc030_case_writer_insert` (restrictive INSERT for `emalahleni_worker`).
- The isolated audit policies `sc030_audit_insert` and `sc030_audit_read` apply to `emalahleni_worker`.

## Critical interpretation

The `sc030_*` audit policies and restrictive application INSERT policy were created by the **synthetic-only fixture** `20261027_smart_capture_SYNTHETIC_BRANCH_AUDIT_FIXTURE.sql`. They are not canonical production policies. Do not run that fixture in production or another branch. A read-only check cannot establish that production has matching schema, privileges or actor rules.

The earlier isolated transaction demonstrated a synthetic draft insert and audit event within a rolled-back transaction using the restricted worker role. This is strong evidence for the isolated branch only, not evidence that the live application can create such a draft.

## Next engineering gate

1. Compare the existing canonical production migration history and current application DB schema through an approved read-only channel.
2. Write an idempotent, reviewed migration only after the canonical `audit_events` contract is known. Avoid unconditional `CREATE TABLE` or `GRANT` statements based solely on the preview fixture.
3. Verify direct SQL privilege denial for nonwriters, cross-project actor isolation, `DRAFT`-only creation and audit atomicity.
4. Execute against a **new disposable schema-only test branch** first; record rollback and check production untouched.
5. Require reviewer approval before any application to the live database.

**Disposition:** isolated role and schema evidence collected; canonical production parity remains **BLOCKED / UNVERIFIED**.
