# Smart Capture — Google Drive synthetic fixture

Created 27 October 2026 with the user's authorisation for synthetic-only testing.

- Approved existing Drive root: `1NqFEN-rGEtXAzyk5HPDl4oFZOkJJqbru`
- New immediate-child synthetic folder: `1jTDNtpo0KAp27vf4f6G6eBTYc8HKS2tA`
- Synthetic beneficiary subfolder (immediate child of test root): `1ukw-8tFxcdfB2G-L8fs_VBKBOhsQNSh5`\n- Synthetic PDF: `1YUJLAGci2yHXAXpwKFYJtfthQK9MnGZd` (housing application with fictitious names and values; explicitly marked synthetic)
- Verified using the connected Google Drive integration that the PDF is present in the beneficiary subfolder. The layout matches the application discovery contract: approved root → beneficiary folder → PDF.
- This verifies **Drive write and list through ChatGPT's connector**, NOT the separate Smart Capture Worker service-account Drive access, not OCR, not import processing.
- Never enable production Smart Capture flags or point production at this folder for testing. Test only with isolated worker, isolated queue, isolated Neon branch and explicit reviewed configuration.
- **No real beneficiary PDFs may be read or indexed.** Preserve the existing approved root and existing beneficiary folders unchanged.

Next acceptance steps: verify isolated service-account access to this folder; confirm discovery imports only synthetic PDF metadata; invoke safe scanner and Document AI test configuration; verify encrypted proposal and officer draft in isolated Neon; record full evidence and rollback. Do not claim E2E completion before all stages pass.

## SC-I07 live read-only service-account acceptance (28 Oct 2026)

The ChatGPT-connected Google Drive account has re-listed the test root and confirmed
**exactly one** child folder, with **exactly one** 27,213-byte PDF inside it.
This is not proof of access from the Worker service account.

Run the repository script using a short-lived OAuth token minted for the **isolated
Smart Capture service account**, not the user's interactive Google session:

```sh
cd emalahleni-app
# Obtain token securely through the isolated service account's existing
# credential workflow. Do not print it, paste it into ChatGPT, or commit it.
SMART_CAPTURE_SYNTHETIC_DRIVE_ACCESS_TOKEN="$ISOLATED_DRIVE_ACCESS_TOKEN" \
  node --import tsx scripts/check-smart-capture-drive-access.ts
```

The script strictly checks the synthetic root, beneficiary folder, PDF ID and
expected file size using Google Drive metadata GET requests. It does not download
PDFs or access Neon, Cloudflare, or production ingestion. It refuses unexpected
folders, files or pagination rather than broadening scope. A passing check means
**service-account Drive discovery only**, not OCR or an end-to-end draft.

Capture only the redacted PASS/FAIL output and timestamp for the acceptance ledger.
On failure, grant the isolated service account read access **only to the synthetic
test root** and necessary descendants; never widen access to the real beneficiary
folder. Test environment and its credentials must remain separate from production.

## 28 October 2026 — Work credential blocker and recovery

ChatGPT Work inspected the script at commit `86afc6f` but could not run it:
`SMART_CAPTURE_SYNTHETIC_DRIVE_ACCESS_TOKEN` was unavailable. **No Google API
request was made, so no permission error or service-account access result exists.**

Commit `ad3e2368` removes the need to mint a separate token externally:
the script can now call the application's existing `googleServiceToken` using
**isolated service-account credentials injected into its execution environment**.
It requests only the `drive.metadata.readonly` scope. The script also continues
to accept a pre-minted short-lived token as an alternative, but refuses both
credential modes simultaneously. No secrets, JWT, token, file contents or
provider error bodies should be printed.

Safe execution requirements:

1. Confirm a **separate isolated Google service account** exists and has read-only
   access limited to synthetic test root `1jTDNtpo0KAp27vf4f6G6eBTYc8HKS2tA`.
   Do not grant access to the real beneficiary Drive tree.
2. In a local or isolated runner, securely inject the existing key and email
   as `SMART_CAPTURE_SYNTHETIC_DRIVE_PRIVATE_KEY` and
   `SMART_CAPTURE_SYNTHETIC_DRIVE_CLIENT_EMAIL`. Do not expose them to a PR,
   build log, GitHub workflow file, ChatGPT chat or shell history.
3. Run `node --import tsx scripts/check-smart-capture-drive-access.ts` from
   `emalahleni-app/`, with `SMART_CAPTURE_SYNTHETIC_DRIVE_ROOT` set to the
   synthetic test root if used.
4. Record the script's PASS or FAIL, an UTC timestamp, and the **non-sensitive**
   Google service-account email only if acceptable to the operator's security
   policy. On access denial, do not change production permissions.

If no isolated service-account key/identity exists, **stop** and provision it
using the security-approved Google Cloud IAM workflow; do not copy a production
key or substitute a personal Google account token. No runtime access has been
verified by this change.

## Preferred keyless desktop procedure (Google Cloud CLI)

Use this only after confirming the correct **isolated Google Cloud project** and
isolated service account email. Avoid JSON key downloads.

1. Sign into `gcloud` as the authorised operator (`gcloud auth login`) and set
   the isolated project explicitly (`gcloud config set project PROJECT_ID`).
2. Verify that the operator has permission to impersonate only this isolated
   service account (`roles/iam.serviceAccountTokenCreator` on that account).
   Do not grant broad project-wide ownership or bind production identities.
3. Share the **synthetic Drive test root only** with the isolated service
   account's email as Viewer (including inherited child-folder access).
4. From `emalahleni-app/` in the operator's trusted local terminal, mint the
   short-lived token directly into an environment variable without showing it:
   
   ```sh
   export SMART_CAPTURE_SYNTHETIC_DRIVE_ROOT=1jTDNtpo0KAp27vf4f6G6eBTYc8HKS2tA
   export SMART_CAPTURE_SYNTHETIC_DRIVE_ACCESS_TOKEN="$(gcloud auth print-access-token \
     --impersonate-service-account=ISOLATED_SERVICE_ACCOUNT_EMAIL \
     --scopes=https://www.googleapis.com/auth/drive.metadata.readonly)"
   node --import tsx scripts/check-smart-capture-drive-access.ts
   unset SMART_CAPTURE_SYNTHETIC_DRIVE_ACCESS_TOKEN
   ```

5. Record only the script's redacted PASS/FAIL and timestamp. Never paste a token
   or key into GitHub, ChatGPT, screenshots or shell history. Disable/revoke the
   temporary impersonation grant if it was added solely for this test.

If Google returns `403`, check (a) the operator's impersonation permission,
(b) the isolated service account's **Viewer** access to the synthetic root and
(c) whether domain sharing policies allow the isolated account. Do not grant
access to the real beneficiary Drive folder. If an isolated account or safe
impersonation is unavailable, remain BLOCKED rather than using production keys.
