# Vectra Assure R1 — isolated acceptance deployment

This is a **configuration scaffold**, not a deployed Worker.

- Worker: `vectra-assure-r1-acceptance`, workers.dev only; **no custom domain**.
- R2: `vectra-assure-r1-evidence-test` (private bucket, created by account owner).
- Scanner: `vectra-assure-r1-scanner`, separate container and Durable Object; no reuse of the existing staging scanner.
- Neon: use **only** branch `test/vectra-r1-acceptance-20261102` (`br-curly-snow-zal4ef7o`) in project `summer-cell-31554288`.
- Default flags disable document uploads and ID OCR until authenticated services, scanner and private synthetic-only bucket have been verified.
- The acceptance branch was cloned from staging and contains inherited application/evidence records. Do not expose or exercise these records; only use designated synthetic accounts/projects. Review and scrub the acceptance branch if any real data is present.

## Before deployment

1. Confirm availability of Cloudflare Workers Containers in the account and provision **separate** scanner resources (or leave the document features disabled).
2. Set `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` and `SCANNER_TOKEN` with branch-specific credentials through scoped deployment secrets/configuration. Never commit passwords or token values. Verify that the auth issuer is for the **acceptance** branch, not the production or staging auth URL.
3. Verify the authenticated app Worker database role is `emalahleni_worker` and that RLS is active.
4. Confirm the Worker route does not include `app.vectrasa.co.za` or the existing `emalahleni-api-staging` Worker.
5. Build from PR #14 and review the dry-run output using `wrangler deploy --config wrangler.r1-acceptance.jsonc --dry-run --containers-rollout=none` from `emalahleni-app`. **Do not run the existing `npm run deploy`**: that targets the preexisting Worker.
6. Obtain explicit deployment approval after confirming credentials, scanner availability, rollback plan and that no inherited records contain real PII.

## Acceptance tests

- Login with a designated synthetic user; ensure users without project membership cannot list cases.
- Capture and save a synthetic case, upload/scan a synthetic ID document **only after** upload and OCR flags are deliberately enabled with a dedicated scanner.
- Verify the saved-form consistency result matches the source SHA and case version, shows the human-review warning and survives reopen.
- Reject cross-project access, stale form version, changed evidence SHA, missing membership and reviewer writes.
- Verify no auto approval or status transition occurs.

## Rollback

Disable acceptance Worker routing, delete only acceptance Worker/container and private test bucket when approved, and delete only the Neon **test** branch. Never alter the staging branch, production branch, existing staging bucket or custom domain.
