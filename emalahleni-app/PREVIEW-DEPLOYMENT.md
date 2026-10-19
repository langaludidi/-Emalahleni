# Vectra Assure isolated preview

The preview config is `wrangler.preview.jsonc`. It is **not deployed** by committing this file.

## Safety preconditions

- Dashboard-only preview intentionally has **no R2 bucket or scanner container binding**. All uploads, evidence downloads, document routes and case mutations must be denied; never reuse staging resources.
- Provision a **separate Neon database and auth project with synthetic accounts only**. Set its database URL and encryption secret through preview Worker secrets, never GitHub files.
- Do not copy staging or production credentials, encryption keys, beneficiary records or storage objects.
- Preview configuration disables case API, uploads and ID reading. Verify these flags are enforced by runtime before exposing the host. If not, block deployment and add enforcement.
- The preview does **not** run a scanner. A future evidence-enabled preview would require separately provisioned R2/scanner resources and a new security review.
- Configure preview-only authentication endpoints after provisioning; do not reuse staging auth.
- Keep preview access limited to approved testers and synthetic cases.

## Validation and deployment

1. Re-run dashboard and scanner CI on the **latest head SHA** after preview configuration changes.
2. Validate Worker dry-run using `npx wrangler deploy --config wrangler.preview.jsonc --dry-run --containers-rollout=none`.
3. Confirm isolated Neon and Neon Auth exist, restricted Worker login and secrets are configured, and no R2/scanner binding is present.
4. Deploy explicitly from `emalahleni-app`: `npx wrangler deploy --config wrangler.preview.jsonc`. **Never** use `npm run deploy` for preview.
5. Test login, role/project isolation, dashboard PII redaction, blocked case writes, blocked uploads, and scanner health with synthetic data.
6. Share preview URL only after all smoke tests pass.

No DoHS submission approvals or verified geographic maps are included.

## Provisioning record — 19 October 2026

An independent Neon project **Vectra Assure Preview** was created:

- Project ID: `noisy-pond-49029240` (AWS London, PostgreSQL 18)
- Branch: `br-gentle-lab-zab9t10k` (`preview/synthetic-only`)
- Database: `vectra_preview`
- No staging records were copied. The database initially had zero public application tables.
- The latest preview access-control fix `a381946` passed dashboard and scanner CI. Subsequent commits require their own checks.

**Dashboard-only schema bootstrapped:** seven tables, staging-derived constraints/indexes, the DoHS field guard, FORCED RLS and read-only SQL-created roles are installed in the isolated preview. See `db/preview/README.md` and `01`–`04` bootstrap scripts. This does **not** reproduce the full capture/evidence/scanner schema and must not be treated as release-ready. The original staging branch is `br-withered-sun-za5qurkv` in project `summer-cell-31554288` and was read-only during recovery.

**Implemented:** restricted `emalahleni_worker` NOLOGIN role (no bypass-RLS or role/db creation), scoped reader grants, two fictional projects and five AES-GCM encrypted fictional applications. Alpha/Beta/unassigned access isolation tests passed. The test-only encryption key is not committed.

**Operational blockers:** safely enabling preview-only worker credentials, preview-specific Cloudflare rate-limit bindings, Worker secrets and deployment, auth trusted origin, authenticated end-to-end smoke tests and latest-head CI. Neon Auth is now isolated and configured. The read-only preview intentionally does not bind R2 or scanner. No preview Worker is deployed.

## Schema recovery checklist (read-only)

The repository's searchable default branch does not expose a complete SQL migration history. Before attempting any database schema changes:

1. Inspect the original migration source used to create staging, including version numbers, extensions, table constraints, triggers, functions, indexes, grants and row-level security policies. Do not infer the schema from dashboard queries.
2. Compare that source against the current staging schema without exporting application rows or credentials. Record drift and resolve it in reviewed migrations.
3. Review role ownership and `emalahleni_worker` grants. The Worker requires a restricted login with RLS enforced and no database ownership or bypass privileges.
4. Apply approved, idempotent migrations only to project `noisy-pond-49029240`, database `vectra_preview`. Do not run them against `summer-cell-31554288`.
5. Verify policies for unauthenticated, unassigned, other-project and read-only identities before seeding any fictional data.
6. Keep the preview Worker disabled until authentication and isolated secrets are configured and security acceptance passes.

This checklist is documentation only; it does not create roles, tables, identities or records.
