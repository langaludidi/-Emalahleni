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
