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

## Acceptance security gate (2 November 2026)

- Dedicated Neon acceptance branch: `br-curly-snow-zal4ef7o`.
- Its Auth endpoint is `https://ep-shiny-field-zakdrjle.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth` and differs from staging's endpoint.
- The branch inherited **9 Neon Auth users**, 2 applications and 3 evidence records. A count-only query could not classify any of those Auth accounts as provably synthetic by test-email convention. **Do not expose this branch to a publicly enabled case API** until inherited data is reviewed and a destructive test-only cleanup is separately approved. No user deletions have been performed.
- The dedicated Worker config keeps `ENABLE_CASE_API`, `ENABLE_DOCUMENT_UPLOADS`, and `ENABLE_ID_READING` disabled by default.
- The Next.js frontend originally embedded staging Neon Auth. This branch now supports `NEXT_PUBLIC_NEON_AUTH_BASE_URL` at compile time. A dedicated preflight rejects missing/incorrect acceptance Auth URLs, reused R2/scanner names, custom domains, or plaintext secrets, and examines the compiled JavaScript for staging Auth references.
- No Worker or scanner is deployed by this CI job. The dedicated GitHub workflow `vectra-r1-acceptance.yml` performs build, asset verification and Wrangler **dry-run only**.

### Minimum safe build command (does not deploy)

```bash
cd emalahleni-app
export NEXT_PUBLIC_NEON_AUTH_BASE_URL='https://ep-shiny-field-zakdrjle.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth'
node scripts/check-r1-acceptance.mjs
npx next build web
node scripts/check-r1-acceptance.mjs --verify-assets
npx wrangler deploy --config wrangler.r1-acceptance.jsonc --containers-rollout=none --dry-run --outdir dist/r1-acceptance
```

### Subsequent deployment prerequisites

1. Confirm the cloned Auth identities and records are sanitized or replaced with exclusively synthetic test identities, with separate user approval for destructive cleanup.
2. Obtain scoped Cloudflare access to create **only** `vectra-assure-r1-acceptance` and `vectra-assure-r1-scanner`. An initial Dockerfile-based container deployment requires a functioning Docker-compatible build engine or Cloudflare Workers Builds; `--containers-rollout=none` does **not** provision the initial scanner image.
3. Configure `DATABASE_URL` for the **acceptance** Neon branch, `FORM_ENCRYPTION_KEY` for new synthetic forms, and `SCANNER_TOKEN` through encrypted Cloudflare secrets, never in source.
4. Whitelist only the actual acceptance Worker origin in the acceptance branch's Neon Auth trusted origins once the Worker exists. Do not reuse the staging frontend hostname.
5. Verify private R2 binding, scanner health, synthetic identity sign-in, project RLS and version/hash rejection before enabling case API and document flags for the acceptance Worker.
6. Keep `app.vectrasa.co.za`, `emalahleni-api-staging`, and `emalahleni-evidence-staging` untouched.
