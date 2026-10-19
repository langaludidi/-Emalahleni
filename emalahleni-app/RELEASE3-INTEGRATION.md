# Release 3 integration and preview gate

Status: **candidate only — not deployed**.

## Verified automated checks

Commit `11e61a6790080aac8567bdffda43ce5eb6c662e4` passed both Release 3 dashboard checks and private scanner checks on 19 October 2026. Any newer commits must pass both checks again.

## Integration with main

At review time, `feature/project-dashboard-readonly` was 17 commits ahead of and 3 behind `main`. The three upstream commits modify the private scanner, document service probe, evidence contracts, tests and scanner CI. Preserve all scanner changes from main. Do not force-push, rewrite main, or assume earlier checks cover the integrated candidate.

1. Merge current `main` into this feature branch in a clean checkout and resolve any conflicts without dropping scanner security checks.
2. Run `npm ci --ignore-scripts`, `npm --prefix scanner install --ignore-scripts --no-audit --no-fund`, `npm run typecheck`, `npm test` and `npm run build` from `emalahleni-app`.
3. Confirm both GitHub Actions workflows pass on the *integrated head SHA*.
4. Confirm project access denial, dashboard response PII exclusion, scanner safety and existing application capture flows using synthetic data.

## Isolated preview only

Deploy to a separate Cloudflare preview Worker and isolated preview configuration. Do **not** reuse production/staging database write credentials, R2 bucket, secrets or routes. Do not deploy by merging `main` because `main` triggers staging. Verify preview host and sign-in with fictional test accounts before sharing a link.

## Release exclusions

The workbook's 63 checks have not been reconciled and approved. Do not claim DoHS approval or enable final submission issuance. Ward/village mapping, verified coordinate endpoint, beneficiary writeback resolution and departmental pack generator remain incomplete. Keep the existing capture workflow unchanged.
