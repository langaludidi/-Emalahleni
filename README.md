# Emalahleni beneficiary assurance

Development source for the Cloudflare staging app.

## Download

Open [Emalahleni_Build.zip](./Emalahleni_Build.zip), then click **Download raw file** (the download arrow above the file). The ZIP is the earlier version 0.2 snapshot. Use **Code → Download ZIP** for the latest source, including the email-verification flow. The application is in `emalahleni-app/`.

## New features

- Read embedded photograph GPS/capture dates with exifr and apply them as unconfirmed proposals. EXIF values are linked to the verified photograph's file hash.
- Generate preview or recorded-case verification summaries with react-pdf.
- Combine verified, clean evidence into draft PDF packs with pdf-lib, checking file hashes and the case fingerprint.
- Preserve full DoHS review timestamp precision for concurrency checks.
- Request and verify an email code when Neon blocks sign-in for an unverified email.

The feature libraries are MIT licensed; their notices are included in `emalahleni-app/THIRD_PARTY_LICENSES.md`.

## Run

Use Node.js 24 or newer:

```sh
cd emalahleni-app
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

Open http://localhost:8787.

## Verification

Seventeen local tests passed, including real EXIF parsing, generated PDF inspection, evidence filtering, hash mismatches and stale-pack rejection. Frontend and Worker dry-run bundles built successfully. The [GitHub build/browser run](https://github.com/langaludidi/-Emalahleni/actions/runs/38540486238) passed desktop/mobile Chromium journeys and generated PDF downloads. The isolated Neon document integration run also passed, using real database isolation and explicit storage/scanner doubles.

## Deployment and remaining work

The [staging preview](https://emalahleni-api-staging.ludidil.workers.dev) is deployed through Cloudflare Workers Builds from `main`. On 14 October 2026, the build succeeded, the operator confirmed the browser preview and entry of the three runtime secrets, and the deployed R2 fixed-key probe returned `reachable` with writes disabled. Read [the deployment guide](./emalahleni-app/README.md) for configuration and evidence limits. Credentials are excluded. Authenticated synthetic case access is enabled when the runtime secrets are configured; document uploads remain disabled.

PDF exports remain drafts while the rules are provisional. Printed photo overlays still need manual entry or OCR. The prepared restricted database credential and scoped staging database probes passed. Browser email verification, sign-in, saved-case reload and sign-out remain pending. Scanner integration and the complete storage upload/review/download flow, physical phone verification, final rules approval and operational safeguards remain outstanding. This is a development build, not a production release.
