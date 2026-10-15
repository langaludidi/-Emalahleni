# Private document scanner and ID reader

This directory provides the private scanner Container attached to the app Worker. The initial isolated Docker/ClamAV/OCR checks passed. The failed 15 October build provisioned the Container but replaced the app handler; the canonical deployment now preserves both in one Worker. The API's document-upload and ID-reading flags stay off until the service passes live checks through its authenticated API probe.

The account owner enabled the **Workers Paid plan** on 15 October 2026. The first build created the scanner Container application but accidentally deployed its handler onto the app Worker. The repair retains that application and exports the app and scanner together. A paid subscription alone does not establish live scanner readiness. The current published baseline is $5/month for Workers Paid, with separate metered Containers/Workers/Durable Objects usage. This template limits the scanner to **one standard-1 instance (4 GiB RAM, 0.5 vCPU, 8 GB disk)** and sleeps after five minutes idle. At published rates, memory alone costs $0.036 per active hour beyond the included allocation; allocated disk is about $0.002016/hour, CPU is metered separately. These are rates, not a monthly cap. See [Cloudflare pricing](https://developers.cloudflare.com/containers/platform/pricing/) and [instance limits](https://developers.cloudflare.com/containers/platform/limits/).

## Processing contract

- POST `/scan`: binary PDF/JPEG/PNG or `application/octet-stream`, maximum 5 MiB; success exactly `{sha256, verdict: 'CLEAN' | 'INFECTED'}`.
- POST `/read-id`: binary PDF/JPEG/PNG only, maximum 5 MiB; malware scan runs again **before any decoder**. Success exactly `{sha256, text}` with at most 16,000 UTF-8 bytes. An infected file returns HTTP 422 with exactly `{sha256, verdict: 'INFECTED'}`. The API must invalidate its previously clean scan state.
- GET `/healthz`: authenticated readiness of ClamAV, a signature database no older than seven days, Poppler, Tesseract and its English language data. Missing signatures/tools return 503, never a fabricated clean result.
- Every endpoint requires `Authorization: Bearer <SCANNER_TOKEN>` (minimum 32 characters). The app has a public URL, but it does not route public requests to the scanner. Only authenticated, project-scoped API actions can invoke the internal adapter.
- Freshclam uses the official ClamAV signature mirror; outbound Internet is enabled for signature updates. ID contents are processed inside the private service, never sent to an AI API. OCR text is temporary and returned to the API for deterministic parsing and operator confirmation. OCR is not identity verification or a departmental decision.

PDFs are limited to two pages and rasterised to a maximum side of 2,600 pixels. Images must be at most 6,000 pixels on either side and 12 million pixels total. Processing accepts one document at a time; additional requests return 429. Decoder subprocesses use a non-root account, a 1 GiB address-space limit, CPU and file-size limits, wall-clock cancellation, capped text output and private temporary files removed in a finally block. No document content, source filenames, credentials or raw decoder errors are logged.

## Validate without a provider deployment

From `emalahleni-app/scanner` with Node 24 and Tesseract/Poppler/util-linux installed:

```sh
npm install --ignore-scripts
npm test
npm run typecheck
```

The app root's `npm ci` installs the pinned scanner SDK through its `prepare` script. The app's `npm run build` checks the canonical Worker bundle, including its `DocumentScanner` export. The isolated scanner CI workflow tests HTTP/OCR, builds the image and tests actual ClamAV plus harmless EICAR. It does not deploy anything or use Cloudflare credentials. The initial image and all five scanner tests passed in GitHub Actions; the corrected cold-start implementation must pass again before live acceptance.

On a Docker-capable computer:

```sh
docker build --platform linux/amd64 -t emalahleni-scanner-test .
docker run -d --name emalahleni-scanner-test --memory 4g --cpus 1 --mount type=bind,src="$PWD",dst=/contract,readonly --env SCANNER_TOKEN=synthetic-scanner-integration-token-00000000 emalahleni-scanner-test
docker exec emalahleni-scanner-test node /contract/test/clamav-integration.mjs
docker rm -f emalahleni-scanner-test
```

EICAR belongs only in this isolated test container. Do not submit it to the live app or upload a real ID during setup. The image build downloads the public ClamAV signatures as the non-root scanner user; a failed seed download fails the build. The signature layer precedes the application-code copy, so ordinary source changes can reuse it. Cold starts load that seed immediately instead of downloading the full databases onto each ephemeral disk. The HTTP port stays closed while clamd loads the database, so the Container SDK waits for the engine rather than forwarding the first scan prematurely. A failed daemon start never opens the port.

After clamd answers its private PING command, freshclam starts in the background and the HTTP listener opens. The updater checks immediately for incremental updates and notifies the running daemon to reload them. It checks twelve times daily while the instance remains awake. A missing or more-than-seven-day-old loaded database still blocks every scan and readiness check; the image seed never bypasses that gate. An old cached seed can therefore remain unavailable until its background update and reload complete. Logs contain only generic operational error codes.

Public signatures add image size and registry storage, trading that cost for shorter cold starts and fewer complete downloads. Refresh the seed in a regular rebuild at least weekly. For a manual Docker build, use `--build-arg CLAMAV_SIGNATURE_REFRESH=YYYY-MM-DD` with a new date, or invalidate that build layer. The Dockerfile's default refresh value is a build-cache key, not a freshness claim. For Workers Builds, change that default value or supply the matching Container image build variable on the scheduled refresh. Avoid repeated uncached full downloads; the official signature CDN can rate-limit them. The existing isolated Docker CI check must pass against each changed image before enabling uploads.

## Deployment through the existing app build

Use the existing Workers Builds connection for `emalahleni-api-staging`: repository `langaludidi/-Emalahleni`, branch `main`, root `/emalahleni-app`, build `npm run build`, deploy `npm run deploy`. Do not create or deploy a second Worker from this connection. Workers Builds overrides mismatched Worker names to its connected Worker, which caused the first failed deployment.

`wrangler.jsonc` is the only deployment configuration. It preserves the existing `DocumentScanner` export, `SCANNER_CONTAINER` Durable Object binding and Container application name `emalahleni-scanner-staging-documentscanner`. Its `exports.DocumentScanner.container` explicitly references that application. No namespace deletion, rename or transfer is required. `workers_dev=true` restores the public app URL; preview URLs remain off.

The production entrypoint exposes the ordinary app API and static assets. It creates a private in-process adapter for the API's `SCANNER` interface. The scanner handler is never the public fetch handler, and no `/scan` or `/read-id` public route is added. Only `SCANNER_TOKEN` is passed to the Container. Preserve the Worker's existing runtime secrets, especially `DATABASE_URL` and `FORM_ENCRYPTION_KEY`. Deployment does not read, generate, print or rotate secrets. Upload and ID-reading flags remain false.

The retired scanner-only Wrangler configuration and multi-Worker deployment script must not be reused: the failed build attached `DocumentScanner` to the API Worker, so app versions must continue exporting that class. Removing it produces provider error 10064. The existing Container name must remain explicit to avoid creating a second application under the API Worker's name.

After deployment, open a saved case's Documents & readiness step and press **Check document service**. This calls private health, clean-scan and OCR paths with a fixed synthetic PDF and returns a readiness summary without storing any document or returning OCR text to the browser. It works while feature flags are off. A successful result precedes controlled synthetic upload/read/review acceptance.

## Live acceptance before enabling features

Use the authenticated internal probe through the app API, never a public scanner route. Check readiness once, then retry manually after provisioning/database loading completes; do not keep an idle container awake with continuous health polling. Health, upload scans and ID reading allow **120 seconds including cold start**. The private adapter uses native Durable Object fetch, and startup runs inside the owning Container class. Startup allows up to 30 seconds to obtain an instance and a 90-second port-readiness budget; processing retains its separate 50-second deadline and observes request cancellation. The isolated image test runs with the production limits of 4 GiB RAM and 0.5 vCPU and requires readiness within 90 seconds. Allocation, image provisioning or expired signatures can still cause a 503; these never count as a clean or readable document.

1. GET private `/healthz` reports ready; wrong/missing credentials are rejected.
2. Upload a synthetic PDF through the API: R2 bytes, stored hash and scanner hash agree; status advances to CLEAN and still awaits assessor review.
3. Read synthetic ID details: the returned candidate values are shown for confirmation, do not overwrite fields automatically, and do not count as document verification.
4. Exercise unavailable-scanner handling with a staging-only controlled test; verify no fake clean status or successful extraction appears.
5. Verify role/project isolation, quarantine/download restrictions and retry behaviour. EICAR coverage remains in the isolated test container.

Enable the upload flag only after the live upload/scan checks pass. Enable the separate ID-reading flag only after live OCR and confirmation checks pass. Keep evidence and personal details out of deployment notes and provider logs.

References checked against current official sources: [deployment](https://developers.cloudflare.com/containers/guides/deploy/), [Container class](https://developers.cloudflare.com/containers/api/container-class/), [get started](https://developers.cloudflare.com/containers/get-started/). The config uses SQLite `exports` and intentionally does not combine it with legacy `migrations`.

Operational logs are enabled for the Worker and Container. Request invocation logs and traces are disabled, and query strings are redacted. The custom lifecycle hooks emit only fixed readiness/error codes, a whitelisted startup reason and elapsed milliseconds. The application’s diagnostic responses and lifecycle logs exclude provider messages, credentials and document text. The authenticated service probe distinguishes configuration, instance allocation, port readiness, process exit and startup-request failures. Use the app Worker's Observability tab to inspect these events after a failed check.
