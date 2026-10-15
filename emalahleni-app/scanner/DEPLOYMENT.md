# Private document scanner and ID reader

This directory prepares a separate Cloudflare Worker and Container. It is not deployed. The API's document-upload and ID-reading flags must stay off until the service passes live probes through its private service binding.

The account owner enabled the **Workers Paid plan** on 15 October 2026. The scanner still needs provisioning; enabling a paid subscription does not establish a running scanner or token permissions. The current published baseline is $5/month for Workers Paid, with separate metered Containers/Workers/Durable Objects usage. This template limits the scanner to **one standard-1 instance (4 GiB RAM, 0.5 vCPU, 8 GB disk)** and sleeps after five minutes idle. At published rates, memory alone costs $0.036 per active hour beyond the included allocation; allocated disk is about $0.002016/hour, CPU is metered separately. These are rates, not a monthly cap. See [Cloudflare pricing](https://developers.cloudflare.com/containers/platform/pricing/) and [instance limits](https://developers.cloudflare.com/containers/platform/limits/).

## Processing contract

- POST `/scan`: binary PDF/JPEG/PNG or `application/octet-stream`, maximum 5 MiB; success exactly `{sha256, verdict: 'CLEAN' | 'INFECTED'}`.
- POST `/read-id`: binary PDF/JPEG/PNG only, maximum 5 MiB; malware scan runs again **before any decoder**. Success exactly `{sha256, text}` with at most 16,000 UTF-8 bytes. An infected file returns HTTP 422 with exactly `{sha256, verdict: 'INFECTED'}`. The API must invalidate its previously clean scan state.
- GET `/healthz`: authenticated readiness of ClamAV, a signature database no older than seven days, Poppler, Tesseract and its English language data. Missing signatures/tools return 503, never a fabricated clean result.
- Every endpoint requires `Authorization: Bearer <SCANNER_TOKEN>` (minimum 32 characters). There is no public Worker URL, preview URL, custom domain or route.
- Freshclam uses the official ClamAV signature mirror; outbound Internet is enabled for signature updates. ID contents are processed inside the private service, never sent to an AI API. OCR text is temporary and returned to the API for deterministic parsing and operator confirmation. OCR is not identity verification or a departmental decision.

PDFs are limited to two pages and rasterised to a maximum side of 2,600 pixels. Images must be at most 6,000 pixels on either side and 12 million pixels total. Processing accepts one document at a time; additional requests return 429. Decoder subprocesses use a non-root account, a 1 GiB address-space limit, CPU and file-size limits, wall-clock cancellation, capped text output and private temporary files removed in a finally block. No document content, source filenames, credentials or raw decoder errors are logged.

## Validate without a provider deployment

From `emalahleni-app/scanner` with Node 24 and Tesseract/Poppler/util-linux installed:

```sh
npm install --ignore-scripts
npm test
npm run typecheck
npm run build
```

The deployment lockfile must be generated and reviewed after the pinned packages can be installed. This workspace cannot connect to the npm proxy or Docker socket, so local Worker bundling and Docker validation remain unverified here. The isolated CI workflow installs dependencies, tests HTTP/OCR, builds the image and tests actual ClamAV plus harmless EICAR. It does not deploy anything or use Cloudflare credentials.

On a Docker-capable computer:

```sh
docker build --platform linux/amd64 -t emalahleni-scanner-test .
docker run -d --name emalahleni-scanner-test --memory 4g --cpus 1 --mount type=bind,src="$PWD",dst=/contract,readonly --env SCANNER_TOKEN=synthetic-scanner-integration-token-00000000 emalahleni-scanner-test
docker exec emalahleni-scanner-test node /contract/test/clamav-integration.mjs
docker rm -f emalahleni-scanner-test
```

EICAR belongs only in this isolated test container. Do not submit it to the live app or upload a real ID during setup. The image build downloads the public ClamAV signatures as the non-root scanner user; a failed seed download fails the build. The signature layer precedes the application-code copy, so ordinary source changes can reuse it. Cold starts load that seed immediately instead of downloading the full databases onto each ephemeral disk. Readiness remains 503 while clamd loads the database.

After clamd answers its private PING command, freshclam starts in the background, checks immediately for incremental updates, and notifies the running daemon to reload them. It checks twelve times daily while the instance remains awake. A missing or more-than-seven-day-old loaded database still blocks every scan and readiness check; the image seed never bypasses that gate. An old cached seed can therefore remain unavailable until its background update and reload complete. Logs contain only generic operational error codes.

Public signatures add image size and registry storage, trading that cost for shorter cold starts and fewer complete downloads. Refresh the seed in a regular rebuild at least weekly. For a manual Docker build, use `--build-arg CLAMAV_SIGNATURE_REFRESH=YYYY-MM-DD` with a new date, or invalidate that build layer. The Dockerfile's default refresh value is a build-cache key, not a freshness claim. For Workers Builds, change that default value or supply the matching Container image build variable on the scheduled refresh. Avoid repeated uncached full downloads; the official signature CDN can rate-limit them. The existing isolated Docker CI check must pass against each changed image before enabling uploads.

## Deployment through the existing app build

The application root now has an orchestrator at `scripts/deploy.mjs`, invoked by its existing `npm run deploy` command. It first runs the read-only Containers permission check. Only after that passes does it build/deploy the private scanner, configure matching scanner/API runtime credentials on initial setup, then deploy the canonical API configuration with `SCANNER` bound. A completed two-sided setup is marked on the scanner Worker; retries preserve that credential. Feature flags remain controlled by the source configuration and currently stay false.

If the existing Workers Builds token or build's Worker restrictions reject this operation, the deployment stops and the account owner must adjust the selected token or use the separate scanner Worker connection described below. The script preserves inherited provider authentication and guard variables. It does not bypass provider restrictions or activate features based on a successful build alone.

After deployment, open a saved case's Documents & readiness step and press **Check document service**. This calls the private health, clean-scan and OCR paths with a fixed synthetic PDF and returns a readiness summary without storing any document or returning OCR text to the browser. It is available while feature flags are off. A successful result is the prerequisite for enabling the source flags for controlled synthetic end-to-end acceptance.

## Provision on the authorised Workers Paid account

Use the existing account `f887a522ca852a80491c2485853d4363`. Create a **separate Worker** named `emalahleni-scanner-staging`, linked to GitHub `langaludidi/-Emalahleni`, branch `main`, root directory `/emalahleni-app/scanner`.

Configure Workers Builds:

| Setting | Value |
| --- | --- |
| Root directory | `/emalahleni-app/scanner` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Preview / non-production builds | Disabled |
| Worker public access | No workers.dev URL, preview URL or public routes |

The automatically created Workers Builds token documents Account Settings (read), Workers Scripts (edit), Workers KV Storage (edit), Workers R2 Storage (edit) and Workers Routes (edit). Containers access is not listed. Check that the selected token also has the required Containers permissions; an account upgrade does not establish this. If provisioning fails with an authorisation error, report it and adjust the selected token through the account owner rather than bypassing it.

Wrangler's deploy builds and pushes the Linux/amd64 Dockerfile. A successful Worker publish does not prove container provisioning completed; check Containers status and perform the private probes below.

Set a **runtime secret** named `SCANNER_TOKEN` on the scanner Worker, using exactly the same private value as the API Worker's existing `SCANNER_TOKEN`. Do not put it in build variables, wrangler.jsonc, GitHub, screenshots, chat or command arguments. Use the Cloudflare secret field, or from an authorised local terminal `npx wrangler secret put SCANNER_TOKEN` and paste only into its private prompt. The Worker passes that secret to the container at startup. The API token must remain a runtime secret.

For a CLI deployment, from `emalahleni-app/scanner` after authentication to the account:

```sh
npm install --ignore-scripts
npm run build
npm run deploy
npx wrangler secret put SCANNER_TOKEN
npx wrangler containers list
```

The API's `SCANNER` service binding must be added **only after this Worker and its container exist successfully**, pointing to `emalahleni-scanner-staging`. Provisioning can take several minutes. Keep `ENABLE_DOCUMENT_UPLOADS=false` and `ENABLE_ID_READING=false` during setup.

## Live acceptance before enabling features

Use an authenticated internal probe through the API service binding, never a public scanner route. Check readiness once, then retry manually after provisioning/database loading completes; do not keep an idle container awake with continuous health polling. The API should allow approximately **45 seconds for scan/health requests** and **90 seconds for ID reading**, including cold start. The adapter allows up to 30 seconds for a listening container port; document processing itself has a 50-second deadline. A 503 during database loading, or while refreshing an expired cached seed, is expected and must show a retryable unavailable status, not an empty/clean document.

1. GET private `/healthz` reports ready; wrong/missing credentials are rejected.
2. Upload a synthetic PDF through the API: R2 bytes, stored hash and scanner hash agree; status advances to CLEAN and still awaits assessor review.
3. Read synthetic ID details: the returned candidate values are shown for confirmation, do not overwrite fields automatically, and do not count as document verification.
4. Exercise unavailable-scanner handling with a staging-only controlled test; verify no fake clean status or successful extraction appears.
5. Verify role/project isolation, quarantine/download restrictions and retry behaviour. EICAR coverage remains in the isolated test container.

Enable the upload flag only after the live upload/scan checks pass. Enable the separate ID-reading flag only after live OCR and confirmation checks pass. Keep evidence and personal details out of deployment notes and provider logs.

References checked against current official sources: [deployment](https://developers.cloudflare.com/containers/guides/deploy/), [Container class](https://developers.cloudflare.com/containers/api/container-class/), [get started](https://developers.cloudflare.com/containers/get-started/). The config uses SQLite `exports` and intentionally does not combine it with legacy `migrations`.
