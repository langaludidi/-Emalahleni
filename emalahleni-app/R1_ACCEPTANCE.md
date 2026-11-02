# Vectra Assure R1 — isolated acceptance deployment

This is a **configuration scaffold**, not a deployed Worker.

- Worker: `vectra-assure-r1-acceptance`, workers.dev only; **no custom domain**.
- R2: `vectra-assure-r1-evidence-test` (private bucket, created by account owner).
- Scanner: `vectra-assure-r1-scanner`, separate container and Durable Object; no reuse of the existing staging scanner.
- Neon: use **only** branch `test/vectra-r1-acceptance-20261102` (`br-curly-snow-zal4ef7o`) in project `summer-cell-31554288`.
- Default flags disable document uploads and ID OCR until authenticated services, scanner and private synthetic-only bucket have been verified.
- The acceptance branch was cloned from staging. Its inherited users and operational records were subsequently cleared with explicit approval; only three new synthetic Auth identities and two synthetic housing projects remain. The case API still stays disabled until full end-to-end acceptance.

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
- At initial inspection the branch had inherited **9 Neon Auth users, 2 applications and 3 evidence records**, none of the Auth users provably synthetic. **Historical observation only:** see the authorised sanitisation section below for the subsequent deletion and synthetic reseeding.
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

## Disposable Neon acceptance branch — authorised sanitisation (2 November 2026)

With explicit approval, the **test branch only** (`br-curly-snow-zal4ef7o`) was sanitised:

- Deleted nine inherited Neon Auth users with Neon Auth user-management operations; associated Auth accounts, sessions, verifications, invitations and memberships confirmed empty.
- Truncated the test branch's user-owned public operational tables, including applications, evidence, upload intents, auditing, project membership, organisations, project records and users. Migration metadata and reference catalogue were retained.
- Verified zero inherited projects, public users, Auth users, applications, evidence, audit events and consistency findings immediately after cleanup; retained 17 `schema_migrations` entries and 1 `rule_catalogue_registry` entry.
- Created **three synthetic Neon Auth accounts** (`r1.officer.20261102@example.invalid`, `r1.reviewer.20261102@example.invalid`, `r1.outsider.20261102@example.invalid`) and corresponding application users.
- Seeded `SYN-R1-A` and `SYN-R1-B` housing projects with test-only membership: Officer and DoHS Reviewer on A; outsider Officer on B. No case or evidence records were fabricated: these must be created by the application with its encrypted form and private R2 workflow.
- Verified real `emalahleni_worker` RLS sessions: officer and reviewer see only `SYN-R1-A`; outsider sees only `SYN-R1-B`; unassigned actor sees no projects.
- Rechecked **parent staging** remained at 9 Auth users, 4 projects, 2 applications and 3 evidence rows. The production branch was not modified.

**Still blocked:** Synthetic Auth users were provisioned as directory identities only; no test password or verified login was established. The acceptance Worker has not been deployed and requires separately scoped Cloudflare access, branch-specific `DATABASE_URL` / encryption secret, an isolated scanner deployment, and acceptance Auth trusted-origin configuration. Do not enable the case API or document flags until these are complete.

## Neon Auth origin and credential readiness — current (2 November 2026)

The dedicated Neon Auth service has an independent endpoint:
`https://ep-shiny-field-zakdrjle.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth`.

- **Acceptance trusted origin:** `https://vectra-assure-r1-acceptance.ludidil.workers.dev` only.
- The copied staging origins (`app.vectrasa.co.za` and `emalahleni-api-staging.ludidil.workers.dev`) were removed from the **acceptance branch only**.
- Verified staging Auth trusted origins are unchanged.
- The three seeded `@example.invalid` users have credential accounts but **no password hashes and no verified email**; they cannot yet be used for a real login, and `example.invalid` cannot receive OTP verification messages. Do **not** manufacture a password hash or bypass verification by SQL.
- To complete authenticated acceptance, create *new, deliverable* synthetic test logins in the isolated Neon Auth branch through the normal sign-up/verification flow (or provision secure credentials using Neon-supported APIs), then link their exact authenticated user IDs to synthetic housing project memberships. Do not reuse a personal or staging identity or paste login secrets into GitHub.

## First Worker and scanner deployment — secure operator handoff

Cloudflare management is not connected to this ChatGPT session; **no Worker or container was deployed here**.

Cloudflare's documentation confirms that the initial `wrangler deploy` can publish the Worker before the container image is built, so a failed image build can leave a reachable Worker. The acceptance configuration deliberately has `ENABLE_CASE_API=false`, `ENABLE_DOCUMENT_UPLOADS=false` and `ENABLE_ID_READING=false` as a fail-closed first stage.

Prerequisites for an **authorised, inert first deployment**:

1. Create a Cloudflare API token with the minimum required Worker creation and Container deployment permissions, scoped to account `f887a522ca852a80491c2485853d4363`. Keep it in the deploy host or Cloudflare Builds secret settings, **not in the repository or ChatGPT**. Once the dedicated Worker exists, restrict future tokens to that Worker.
2. Use GitHub PR #14's `feat/evidence-provenance-consistency-r1` branch, with working Node dependencies and Docker-compatible container image build support. Deploying from a different branch must be independently reviewed.
3. In the local/isolated build environment set these **non-secret** variables:
   - `CLOUDFLARE_ACCOUNT_ID=f887a522ca852a80491c2485853d4363`
   - `NEXT_PUBLIC_NEON_AUTH_BASE_URL=https://ep-shiny-field-zakdrjle.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth`
   - `R1_ISOLATED_DEPLOY_APPROVED=vectra-assure-r1-acceptance`
4. Supply `CLOUDFLARE_API_TOKEN` as a secret to the deploy process. **Leave `DATABASE_URL`, `FORM_ENCRYPTION_KEY` and `SCANNER_TOKEN` unset on this first inert deployment**.
5. From `emalahleni-app` run:
   ```bash
   node scripts/deploy-r1-acceptance.mjs --deploy-isolated
   ```
6. Confirm only `vectra-assure-r1-acceptance` and `vectra-assure-r1-scanner` were created; check `/healthz` reports the case API, uploads and ID reading disabled; check `/storage-healthz` recognises the test bucket. Do not attach a custom domain.
7. If a deployment step fails, inspect the Cloudflare dashboard for a partial acceptance Worker before retrying. **Never invoke the existing `npm run deploy` or `deploy:scanner` scripts:** those address the staging Worker.
8. Later, configure `DATABASE_URL` using the **acceptance** branch's `emalahleni_worker` credentials, a new `FORM_ENCRYPTION_KEY` for new synthetic forms, and a separate `SCANNER_TOKEN` through encrypted Worker secrets. Keep the flags disabled until a real authenticated acceptance session and scanner/R2 tests pass.

Cloudflare Workers Builds can alternatively connect a **new** Worker to the same GitHub repo, with this acceptance branch as its production branch, but that enables automatic deployments on future pushes. Prefer the explicit guarded deploy script while R1 remains a draft. Do not connect the existing staging Worker to the acceptance configuration.
