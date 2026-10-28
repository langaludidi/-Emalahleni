# Application workflow and operating process

Vectra Assure remains a synthetic-data development app. Moving it to a company subdomain does not approve real beneficiary use or submission. The conditional rules remain provisional, and submission readiness is never automatically granted.

## Roles and handoffs

| Stage | Responsible person | Exit condition |
| --- | --- | --- |
| Capture | Assigned admin, officer, field officer, assessor or manager | Capture draft is saved; partial drafts are allowed. |
| Evidence collection | Assigned capture role | File is uploaded to its saved case and the malware scan has a recorded outcome. |
| Evidence review | Assigned admin or assessor | Clean document is checked against the original; content/signatures, applicable certification, document type/date and a review note are recorded. |
| Departmental sections | Assigned DoHS reviewer | Each required section has its own recorded decision and note. |
| Readiness check | Assigned project member | Saved form, evidence and departmental decisions are checked together. Outstanding items remain visible. |
| Submission approval | Authorised business/departmental owner | Remains outside automatic approval while rules are provisional. |

## Capture to evidence

### Create a housing project

Authorised project creators use **Home → New housing project**. Enter a project name and a unique code; client/authority and location are optional. Creation opens the new project with an empty dashboard and grants the creator `ADMIN` access to that project. It uses the existing housing form, evidence requirements and provisional readiness rules. Existing projects, applications and memberships are preserved.

Project creation is a separate, explicitly assigned capability within an organisation. Registering, holding a capture role or administering one project does not automatically grant it. Project creators cannot see other projects without an active membership. Other team members still need their own project/role assignments through the controlled operator setup process; this release does not add a team-management screen.

If creation cannot be confirmed, use **Retry project creation** with the retained details. The same request returns the original project without duplicating its membership or audit entry. A duplicate code must be changed. Cancelling or leaving unsaved project setup asks before discarding it.

### Capture an application

1. Existing users sign in. New users choose **Sign up**, create an account, request the email code and verify it, then sign in. A project administrator must assign their project and role; registration alone grants no case access. Users waiting for assignment can choose **Account → Refresh projects** after access is granted.
2. Choose the assigned project and start a new form or reopen the existing draft.
3. Use a unique synthetic reference beginning `SYN-`. Capture can be incomplete, but formats, dates and coordinates must be valid for saving.
4. Save deliberately. Saving an unchanged draft does not create another version. A successful save remains acknowledged even if refreshing the application picker fails.
5. From site verification, use **Save and open evidence**. Failed saves keep the operator in capture. Capture edits are allowed only for draft or returned applications and an assigned capture role; other saved states are read only.
6. Upload evidence against the saved case. Choosing a file does not upload it. Keep the app open during upload, scanning, reading and review writes; application navigation is held during those operations.

Home keeps capture and in-progress document input in the current tab. Moving out of Documents asks before discarding unrecorded document input. Resume returns to that work. Starting over, changing project/workspace, reopening another application or signing out asks before discarding pending form/document changes. Browser storage is not used to retain beneficiary fields. Closing the tab can still lose unsaved work.

## Document decisions

- Failed scan: the document stays quarantined. Use Retry scan on that document; do not repeatedly upload duplicates. Keep the fixed failure code if escalation is needed.
- Infected file: it stays blocked. A clean scan cannot be assumed from a completed request.
- Clean applicant ID: read suggestions, compare with the original and explicitly confirm selected replacements. Save the form afterward. Reading is not identity authentication or assessor verification.
- Assessor: choose a clean pending document or an earlier approval marked for review after a form change, or use its Review document action. Verify the original, content and required certification before recording a decision. Rejections require a review note too.
- DoHS reviewer: record section decisions separately; capture and assessor roles do not inherit departmental authority.

Refreshing the register retains edited ID suggestions and unrecorded review input. ID suggestions cannot be applied while the evidence register is unavailable; if the source ID is no longer clean and available, its suggestions are removed without changing the form. Switching review documents or reading another ID asks before discarding pending input. Reopening the same assessor document keeps the current note. Use **Clear evidence review** to deliberately discard an unrecorded decision. Review writes are held until the corresponding register has loaded successfully.

Document and departmental approvals are bound to the saved form version checked. Save capture changes before recording a review. Any later form save requires fresh reviews; files and scan verdicts stay intact. Legacy decisions without a recorded form version also require fresh review. Outdated approvals are shown in the register, counted as awaiting assessment on the dashboard and excluded from draft evidence packs. If a form changes while an assessor draft is open, check it again and use **Restart review against saved form**; the note stays, but content/certification confirmations must be checked again.

Review notes and departmental decisions are saved with their own explicit Record actions; Save draft saves capture fields. Use Refresh evidence and reviews after an uncertain response before repeating a mutation.

## Concurrency and exceptions

A version conflict keeps local capture data in place. Reopen the current saved draft and reconcile deliberately; do not overwrite another officer's version. Readiness checks reject a form-version mismatch rather than presenting results for a different saved version. Departmental drafts keep the review timestamp from when editing started, even if the register is refreshed. On a conflict, the note is retained and Reload selected section explicitly reloads the current decision. Existing server-side project membership and write/review permissions remain authoritative.

Scanner failures, unknown availability and failed register requests never count as verified or complete. No background retry repeats a case write or document storage mutation after an uncertain commit.

## Operator checks

Before a controlled test session, confirm project membership, save/reopen a synthetic draft and check document service availability if an upload is unavailable. Review scan retries and returned items on the dashboard. Keep department decisions with their assigned reviewers. Resolve provisional rule ownership and operational support before authorising production use.

## Operational checks and recovery

The public address is https://app.vectrasa.co.za. From the app directory, run `node scripts/check-domain.mjs` to check DNS, HTTPS/application health and the accepted Auth origin. Exit 0 means those public checks passed; exit 2 means at least one remains pending. The probe does not sign in, inspect an applicant case or test mail delivery. The workers.dev address remains a fallback.

For a controlled session, sign in, reopen a saved synthetic case and use **Check document service**. That separate authenticated probe tests the private scanner and ID reader using fixed synthetic bytes. It does not upload a case document or approve evidence. A release acceptance run must separately upload a synthetic document, record its clean scan, read/confirm ID suggestions, save and reopen the case.

| Symptom | Operator response |
| --- | --- |
| No projects or access denied | Ask the project administrator to check the intended identity's active membership and role. Sign-in alone does not grant project access. |
| Save conflict or an uncertain write response | Keep local input. Check/reopen the recorded case and reconcile its version before another write. Saves and reviews are not automatically replayed after an uncertain commit. |
| Evidence/review register unavailable | Refresh the register. Pending input is retained and review writes are held until the relevant register loads. An error does not mean the case has no documents. |
| Stored document reports scan failed | Use Retry scan on that recorded document. Preserve its fixed failure code if it fails again. The file stays quarantined; selecting/uploading another copy is not the recovery step. |
| Scanner starts slowly or reports unavailable | Use the authenticated service check and review the current private-container health/signature state in Cloudflare. A completed build is not proof that the running image is healthy. |
| New domain fails while workers.dev works | Run the public domain check and inspect Cloudflare's zone/custom-domain status. Preserve the existing root/mail records described in DOMAIN_SETUP.md. |

For an incident, record the UTC time, deployed Worker version, project/case/evidence references, action and fixed error code in the approved support channel. Keep beneficiary document content, passwords, reset codes, bearer tokens and encryption keys out of diagnostic reports. Record whether the last write was confirmed before attempting recovery.

### Release rollback

1. Identify the last verified compatible app version in Cloudflare **Workers & Pages → emalahleni-api-staging → Deployments**. The 26 October domain release used version `ee24bb41-41e6-4eee-94bf-a5be9b74b02e`; check that version is still an appropriate recovery target for the current incident.
2. Check schema, binding and Durable Object lifecycle compatibility before selecting an older version. Cloudflare can block rollback after incompatible resource/lifecycle changes. A Worker rollback leaves connected data resources unchanged; it does not restore Neon or R2 data. It also does not establish that the intended scanner image is serving requests—follow the private scanner deployment guide for scanner-image incidents.
3. Use the target version's **three-dot menu → Rollback**. Keep the existing Worker, bucket and scanner namespace and retain the existing encryption key. Do not recreate resources to perform a code rollback.
4. Verify the active version, public domain check, synthetic sign-in/save/reopen and private service check. Record the outcome before reopening affected workflows.

See [Cloudflare's rollback procedure and limits](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) and [private scanner deployment](scanner/DEPLOYMENT.md). Recovery of application data is a separate operation from code rollback.

### Backup and restore acceptance

Backup coverage and a successful restore are still operational acceptance items, not established by the current deployment checks. The service owner must identify the approved database recovery point, R2/evidence copy, encryption-key custody, access owner and retention policy. Record identifiers and access procedures without copying secret values into source or chat. Preserve `FORM_ENCRYPTION_KEY`; regenerating it does not recover existing encrypted forms.

Demonstrate recovery into an isolated, approved test target before relying on the process. Use synthetic fixtures to verify decryption with the original project/case binding, matching evidence hashes, saved versions, audit records and project-role isolation. Confirm the restored database, R2 objects and key correspond to the same recoverable state. Record the recovery point, elapsed recovery time, observed data loss and pass/fail evidence. Do not overwrite the active database or bucket as a restore rehearsal, or reactivate the retired diagnostic account to run it.

Domain onboarding and cutover checks are in [DOMAIN_SETUP.md](DOMAIN_SETUP.md).

## Review-version schema release

Apply `migrations/20261026_review_form_version.sql` to the existing staging database before deploying the matching Worker. It adds two nullable version columns and preserves existing reviews, audit history, stored files and scan results. Do not backfill legacy decisions as current: their original checked version is unknown. The previous Worker ignores these additive columns, so code rollback does not require a schema rollback. A later roll-forward again requires fresh review for decisions written by older code.

Housing-project creation additionally requires `migrations/20261028_housing_project_creation.sql` before the matching Worker. It adds project profile/provenance fields, organisation-scoped creator permissions and two narrowly granted database functions. The Worker retains read-only direct access to projects/memberships; creation, initial ADMIN membership and audit logging occur atomically inside the checked function. Enable a creator only for an explicitly authorised account and organisation; never seed personal account IDs or credentials into repository migrations. Revoking creation permission prevents new projects without removing existing project memberships. Code rollback leaves these additive fields/functions and created projects intact.

The CI PostgreSQL service executes production review SQL to check both orderings of simultaneous draft saves and reviews, competing assessor writes, departmental timestamp conflicts, legacy re-review and infected-file denial. The service database is disposable and guarded by environment assertions.

CI runs type checking, unit tests, PostgreSQL concurrency tests and the build/browser job in parallel. Browser journeys run after their build; the two SQL fixture scripts stay ordered in one disposable database job. The final `verify` check succeeds only when every job passes.
