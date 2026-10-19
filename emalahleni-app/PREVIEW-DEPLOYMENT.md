# Vectra Assure isolated preview

The preview config is `wrangler.preview.jsonc`. It is **not deployed** by committing this file.

## Safety preconditions

- Provision `emalahleni-assure-preview-evidence` as a new R2 bucket. Never point it to the staging evidence bucket.
- Provision a **separate Neon database and auth project with synthetic accounts only**. Set its database URL and encryption secret through preview Worker secrets, never GitHub files.
- Do not copy staging or production credentials, encryption keys, beneficiary records or storage objects.
- Preview configuration disables case API, uploads and ID reading. Verify these flags are enforced by runtime before exposing the host. If not, block deployment and add enforcement.
- Ensure the preview scanner container has separate resources and access.
- Configure preview-only authentication endpoints after provisioning; do not reuse staging auth.
- Keep preview access limited to approved testers and synthetic cases.

## Validation and deployment

1. Re-run dashboard and scanner CI on the **latest head SHA** after preview configuration changes.
2. Validate Worker dry-run using `npx wrangler deploy --config wrangler.preview.jsonc --dry-run --containers-rollout=none`.
3. Confirm isolated R2, Neon and auth exist and that secrets are set.
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

**Schema migration blocked:** do not invent a partial schema. Locate the original version-controlled SQL migrations and apply them to the empty preview database after reviewing roles and RLS policies. The original staging branch is `br-withered-sun-za5qurkv` in project `summer-cell-31554288`, and must not be modified for preview work. Do not use a staging clone as a shortcut.

**Operational blockers:** isolated Neon Auth, restricted `emalahleni_worker` role, reviewed schema, fictional memberships/cases, separate R2 bucket, Cloudflare preview secrets, end-to-end acceptance. No preview Worker is deployed.
