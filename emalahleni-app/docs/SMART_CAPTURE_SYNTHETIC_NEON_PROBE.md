# SC-031 — Queue-to-Neon synthetic-only probe (isolated)

This is **not** a production Smart Capture deployment. It tests the path
Cloudflare Queue → independent Worker → Neon, reading one deliberately synthetic
row. It cannot process PDFs, open Drive folders, create applicants or update
housing records.

## Current isolated Neon setup

- Project: `noisy-pond-49029240`
- Branch: `br-proud-union-zaded8kk` (non-default test branch)
- Database: `vectra_preview`
- Role: `vectra_sc_synthetic_limited` — created with SQL, `NOINHERIT`,
  `NOBYPASSRLS`, no inherited `neon_superuser` role
- Read-only relation: `smart_capture_test.integration_probe`, with FORCE RLS
- Sole row: `{id: 1, marker: 'SYNTHETIC_ONLY', synthetic_imports: 2}`
- Privilege test: the role can SELECT the synthetic marker; reads of
  `public.applications` and `public.smart_capture_imports` fail with
  `permission denied`.

**Security issue discovered and remediated:** an earlier role created using
the Neon connector unexpectedly inherited `neon_superuser` and had BYPASSRLS.
It was immediately deleted and verified absent. The replacement role was
created explicitly in SQL with no inherited memberships, then supplied with
a randomly generated, rotated password. No password or connection string was
committed or displayed.

## Standalone Worker source

`src/smart-capture-synthetic-neon-worker.ts` exports a separate Cloudflare
Worker handler. Its HTTP endpoint is a static test label only. Its queue
handler accepts exactly:

```json
{"type":"SMART_CAPTURE_SYNTHETIC_NEON_PROBE","synthetic":true}
```

It rejects actual Smart Capture messages, requires the explicit
`SYNTHETIC_NEON_PROBE_ENABLED=true` flag, and validates that the secret
`SYNTHETIC_NEON_DATABASE_URL` connects to
`vectra_sc_synthetic_limited` on a Neon host with TLS required. It queries
only the synthetic probe row, logs success without data or credentials, and
retries failures to the existing bounded synthetic dead-letter setup.

## Wiring still required (not performed)

Deploy this file as a **separate**, explicitly reviewed synthetic Worker
using the repository's installed `@neondatabase/serverless` dependency and
Wrangler bundling. Do not paste this import-based source into the Cloudflare
browser editor without a bundler. Bind only
`vectra-smart-capture-synthetic-test`; never attach any beneficiary
processing queue. Configure the Neon connection string as a Cloudflare
**secret**, not a `vars` value, source control entry, screenshot or chat
message. Do not bind Drive credentials or production R2. Keep real Smart
Capture feature flags off.

Before enabling, verify that a running Worker is connected exclusively to
the isolated branch, its role has no elevated memberships, and the synthetic
queue's dead-letter policy has remained intact. The existing dashboard
`vectra-smart-capture-test` is currently a different, manually edited
synthetic-only Worker; do not overwrite it without explicitly deciding to
replace that tested baseline.

No Cloudflare deployment or Neon-to-Cloudflare secret transfer was performed
in SC-031. The synthetic probe role may be deleted after the test concludes.
