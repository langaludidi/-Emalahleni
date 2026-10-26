# Vectra Assure

Vectra Assure is Vectra Solutions' application and evidence workspace. Source is in [`emalahleni-app/`](./emalahleni-app/). Existing backend and repository identifiers keep their original names.

**App:** https://app.vectrasa.co.za  
**Fallback:** https://emalahleni-api-staging.ludidil.workers.dev

The app remains a **synthetic-data development build**. Capture, encrypted draft saving, private document upload/scanning, ID suggestions, assessor/DoHS workspaces, draft PDF exports and the project dashboard are implemented. Rules are provisional and do not approve submission readiness.

## Current verification

- Live synthetic stored-file upload, ClamAV scanning and ID extraction passed on 19 October 2026. The deployed browser confirmation/save/full-reload/reopen journey passed on 20 October. Its temporary diagnostic account and membership were disabled afterward.
- The 26 October [app CI](https://github.com/langaludidi/-Emalahleni/actions/runs/40283721875) and [scanner CI](https://github.com/langaludidi/-Emalahleni/actions/runs/40283721803) passed. App checks include 42 tests, database upload concurrency, type/build validation and desktop/mobile journeys with controlled synthetic API fixtures.
- The custom domain passed DNS, certificate-verified HTTPS, health, private API rejection and exact credentialed Auth-origin checks on 26 October. Account-owner acceptance on this new browser origin is a separate remaining check.

The [application guide](./emalahleni-app/README.md#launch-gates) lists the remaining launch gates, evidence and responsible parties: new-domain account acceptance, live multi-role/project handoffs, approved rules and submission authority, real-data handling, and recovery/operational acceptance. Domain setup does not enable real beneficiary processing.

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

Open http://localhost:8787. Credentials are excluded from the repository.

## Guides and source downloads

- [Application configuration and launch gates](./emalahleni-app/README.md)
- [Capture, evidence and reviewer workflows](./emalahleni-app/WORKFLOWS.md)
- [Custom domain and mail DNS](./emalahleni-app/DOMAIN_SETUP.md)
- [Private scanner deployment](./emalahleni-app/scanner/DEPLOYMENT.md)
- [Third-party licence notices](./emalahleni-app/THIRD_PARTY_LICENSES.md)

Use **Code → Download ZIP** for current source. `Emalahleni_Build.zip` is the older version 0.2 snapshot, retained as a historical download. See the application guide for the implemented EXIF/PDF features and their evidence limits.

