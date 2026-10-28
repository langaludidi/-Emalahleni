# SC-034 — Isolated Neon queue probe: operator acceptance and rollback

**Scope:** synthetic-only Cloudflare Worker `vectra-smart-capture-neon-probe` and isolated Neon branch `br-proud-union-zaded8kk`. This is not the production beneficiary ingestion service.

## Confirmed setup (27 October 2026)

- Cloudflare Worker deployed with queue consumer `vectra-smart-capture-neon-probe-test`, retry limit 3, batch 1, concurrency 1 and dead-letter queue `vectra-smart-capture-neon-probe-test-dlq`.
- Worker deploy reported version `56439f67-8b10-4bf3-99f1-0174964c822b`.
- Operator uploaded Cloudflare secret `SYNTHETIC_NEON_DATABASE_URL` through masked Wrangler prompt; success response received. Its value has not been independently inspected or connection-tested.
- Worker source configuration has `SYNTHETIC_NEON_PROBE_ENABLED=false` by default. A live synthetic connectivity success was observed on 28 October 2026; see the evidence below. The operator subsequently confirmed the dashboard rollback to `false` via screenshot on 28 October 2026.
- Neon project `noisy-pond-49029240`, database `vectra_preview`, branch `smart-capture-sc018-synthetic-isolated`, role `vectra_sc_synthetic_limited`. Role verified LOGIN, no BYPASSRLS, no role memberships, no application SELECT, synthetic probe SELECT allowed.
- All work is on draft PR #11, branch `docs/smart-capture-handoff`; no merge or live app deployment authorised.

## Recorded live synthetic test — 28 October 2026

**Outcome: PASS for isolated queue → Worker → restricted Neon SELECT.** Evidence supplied in operator's Cloudflare dashboard screenshots:

- Queue: `vectra-smart-capture-neon-probe-test` (Active). Worker consumer: `vectra-smart-capture-neon-probe`.
- Consumer configuration: batch size 1; max retries 3; max concurrency 1; DLQ `vectra-smart-capture-neon-probe-test-dlq`.
- Exactly 1 message ingested, 1 acknowledged, 0 retried, backlog 0; the displayed billable operations count was 3.
- Worker Observability: **`Synthetic Neon probe passed`** at **2026-10-28 08:30:47.393 SAST** (06:30:47.393 UTC). Dashboard reported 1 success and 0 errors.
- Encrypted `SYNTHETIC_NEON_DATABASE_URL` secret present (value not disclosed). The synthetic-only enable flag was temporarily displayed as `true`.
- **Rollback verified:** operator screenshot at approximately **08:37 SAST** shows `SYNTHETIC_NEON_PROBE_ENABLED=false` in the isolated Worker's production dashboard settings; encrypted connection secret remains present. The code configuration remains disabled by default.
- **Not independently established:** secret connection string contents, deployed Worker version at test time, DLQ count unchanged, or a complete end-to-end application/OCR workflow.

Evidence provenance: Cloudflare screenshots provided by the operator in the ChatGPT Smart Capture conversation on 28 October 2026; no production credentials or beneficiary data recorded.

## Before enabling (desktop operator action)

1. Check `vectra-smart-capture-neon-probe` (not `emalahleni-api-staging`) in the correct Cloudflare account. Confirm its secret exists **without displaying its value**.
2. Verify consumer and DLQ queue names in Worker bindings and that neither is a production queue.
3. Verify the secret URL points to the isolated Neon branch, restricted role, `vectra_preview`, and TLS `sslmode=require`; do not paste it into a ticket, chat or screenshot.
4. Check the queue backlog is 0, and no unexpected message or consumer exists.
5. Enable `SYNTHETIC_NEON_PROBE_ENABLED=true` only on the isolated Worker. Record the deployment/version.
6. Send exactly one JSON message to `vectra-smart-capture-neon-probe-test`:
   `{"type":"SMART_CAPTURE_SYNTHETIC_NEON_PROBE","synthetic":true}`
7. In Worker Observability, confirm the log **`Synthetic Neon probe passed`** and message acknowledgement. Confirm retry count 0, queue backlog 0, and DLQ count unchanged. These are required evidence; enqueueing alone is not success.
8. If `Synthetic Neon probe failed` appears, **do not resend**. Inspect counts and DLQ; keep credentials hidden. The handler retries up to the configured cap. Record outcome as failed pending diagnosis.
9. Immediately reset `SYNTHETIC_NEON_PROBE_ENABLED=false`. Verify saved setting, and verify a subsequent deployment from the JSONC file will retain the disabled default.
10. Record UTC/SAST timestamp, Worker version, queue metrics, masked log message and outcome. Never record secrets or beneficiary identifiers.

## Emergency stop / rollback

- Disable `SYNTHETIC_NEON_PROBE_ENABLED` on the isolated Worker first.
- If queue consumption must stop, disable/remove **only** the isolated Worker's consumer trigger after recording current queue/DLQ state. Do not purge queues until evidence and retention decisions are reviewed.
- If a connection string was exposed, rotate the restricted Neon role password and replace the Cloudflare secret; verify all previous credentials are invalidated.
- Never change `emalahleni-api-staging`, the original `vectra-smart-capture-test` Worker, production R2 or live Neon branch as part of this probe.
- Never enable real Google Drive ingestion or beneficiary processing from this probe.

## Interpretation

A passing probe demonstrates one read-only SQL query through Cloudflare Queue → isolated Worker → isolated Neon using a restricted role. It does **not** validate OCR, Google Drive, malware scanning, R2, encryption, proposal confirmation, beneficiary deduplication, audit parity, or real-data compliance. Those remain separate acceptance gates.
