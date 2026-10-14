# Emalahleni beneficiary assurance

Version 0.2 development source and refreshed build package.

## Download

Open [Emalahleni_Build.zip](./Emalahleni_Build.zip), then click **Download raw file** (the download arrow above the file). The ZIP includes current source and generated frontend/Worker bundles. Alternatively use **Code → Download ZIP** for the repository source. The application is in `emalahleni-app/`.

## New features

- Read embedded photograph GPS/capture dates with exifr and apply them as unconfirmed proposals. EXIF values are linked to the verified photograph's file hash.
- Generate preview or recorded-case verification summaries with react-pdf.
- Combine verified, clean evidence into draft PDF packs with pdf-lib, checking file hashes and the case fingerprint.
- Preserve full DoHS review timestamp precision for concurrency checks.

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

Read [the deployment guide](./emalahleni-app/README.md). The target is the existing Cloudflare staging Worker. Credentials are excluded. Case access and uploads remain disabled by default.

PDF exports remain drafts while the rules are provisional. Printed photo overlays still need manual entry or OCR. Cloudflare deployment, live user login/scanner integration, live storage verification, physical phone verification and final rules approval remain outstanding. This is a development build, not a production release.
