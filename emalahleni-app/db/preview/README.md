# Isolated Vectra Assure dashboard preview

**Status as of 19 October 2026: database bootstrapped and seeded with fictional data; application NOT deployed.**

This is a **dashboard-only** subset of the source schema. It does **not** implement the full Emalahleni capture workflow, private scanner, DoHS submission flow, imports or evidence upload pipeline. Do not use it for real beneficiaries or a departmental decision.

## Isolation

- New Neon project: `noisy-pond-49029240`
- Branch: `br-gentle-lab-zab9t10k` (`preview/synthetic-only`)
- Database: `vectra_preview`
- Source staging: `summer-cell-31554288` / `br-withered-sun-za5qurkv` (**read-only reference, never write or clone records**)
- Original capture system, production and staging deployments remain unchanged.

## Reproducible fresh-database bootstrap

Use only in a newly created, empty preview database, in this order:

1. `01-tables.sql`: seven core tables from verified schema inspection.
2. `02-constraints.sql`: unique keys, checks, foreign keys and additional indexes.
3. `03-guard.sql`: departmental signature safeguard.
4. `04-access.sql`: forced project RLS and restricted SQL-created roles/grants.

**Run once on a fresh empty database.** These are bootstrap scripts, not safely repeatable incremental migrations. Do not apply to staging, production or an existing populated database.

**Important finding:** In this project, creating roles through the Neon role API gave them `BYPASSRLS` and `neon_superuser` membership despite the API response saying `no_login`. Those trial roles were deleted. The current `emalahleni_worker` and `vectra_preview_reader` roles were instead created explicitly with SQL as `NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS`. Worker inherits only reader, not the owner or neon_superuser role. Verify `pg_roles` and `pg_auth_members` before ever enabling credentials.

The reader is granted SELECT on `projects`, `project_memberships`, `applications`, `evidence`, and `dohs_section_reviews`; no permissions on `users` or `organisations` and no table mutation permissions. The tables with project data have RLS enabled and FORCED, using `app.actor_id` scoping.

## Synthetic fixtures and security acceptance

Only fictional data was seeded using owner-only access:

- 1 labelled fictional organisation; 2 distinct fictional housing projects
- 3 synthetic user IDs (Alpha manager, Beta auditor, unassigned)
- 2 scoped memberships
- 5 fictional applications with separate preview-only AES-256-GCM encrypted forms (3 Alpha, 2 Beta)
- No real beneficiary IDs, phone numbers, uploads or coordinates

Independent Python AES-GCM round-trip on the exact ciphertext format: **5/5 PASS**.

Controlled role-switch database tests, with temporary owner membership revoked immediately afterward:

| Test identity | Visible projects | Visible applications | INSERT / UPDATE |
|---|---|---:|---|
| Fictional Alpha manager | Alpha only | 3 | denied |
| Fictional Beta auditor | Beta only | 2 | denied |
| Fictional unassigned | none | 0 | denied |

Permissions introspection also confirms no worker RLS bypass, no worker login, no worker role/database creation and no access to organisation or user tables.

These are **database-level** checks, not HTTP tests against a deployed Worker or Neon Auth login. Preview may not be shared yet.

## Blockers before a working URL

- Independent Neon Auth has been provisioned; configure preview-only permitted identities and a trusted origin, without reusing staging authentication.
- Provision Cloudflare Worker secrets and preview-specific rate limits. R2 and scanner bindings are deliberately absent from this read-only preview.
- Establish a safe preview-only login credential for the restricted worker, with no privilege escalation, and supply the **test-only** encryption key through Cloudflare Worker secrets. Never commit credentials or the key.
- Verify authenticated GET dashboard, cross-project denial, response PII exclusion and all mutation/upload denials on the actual preview host.
- Re-run both GitHub checks on the latest feature branch head; **do not merge to main**.
- No live DoHS approvals or GPS/site verification have been established.
