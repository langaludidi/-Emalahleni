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

1. Sign in, choose the project, and start a new form or reopen the existing draft.
2. Use a unique synthetic reference beginning `SYN-`. Capture can be incomplete, but formats, dates and coordinates must be valid for saving.
3. Save deliberately. Saving an unchanged draft does not create another version. A successful save remains acknowledged even if refreshing the application picker fails.
4. From site verification, use **Save and open evidence**. Failed saves keep the operator in capture. Capture edits are allowed only for draft or returned applications and an assigned capture role; other saved states are read only.
5. Upload evidence against the saved case. Choosing a file does not upload it. Keep the app open during upload, scanning, reading and review writes; application navigation is held during those operations.

Home keeps capture and in-progress document input in the current tab. Moving out of Documents asks before discarding unrecorded document input. Resume returns to that work. Starting over, changing project/workspace, reopening another application or signing out asks before discarding pending form/document changes. Browser storage is not used to retain beneficiary fields. Closing the tab can still lose unsaved work.

## Document decisions

- Failed scan: the document stays quarantined. Use Retry scan on that document; do not repeatedly upload duplicates. Keep the fixed failure code if escalation is needed.
- Infected file: it stays blocked. A clean scan cannot be assumed from a completed request.
- Clean applicant ID: read suggestions, compare with the original and explicitly confirm selected replacements. Save the form afterward. Reading is not identity authentication or assessor verification.
- Assessor: choose a clean pending document, or use its Review document action. Verify the original, content and required certification before recording a decision. Rejections require a review note too.
- DoHS reviewer: record section decisions separately; capture and assessor roles do not inherit departmental authority.

Refreshing the register retains edited ID suggestions and unrecorded review input. ID suggestions cannot be applied while the evidence register is unavailable; if the source ID is no longer clean and available, its suggestions are removed without changing the form. Switching review documents or reading another ID asks before discarding pending input. Reopening the same assessor document keeps the current note. Use **Clear evidence review** to deliberately discard an unrecorded decision. Review writes are held until the corresponding register has loaded successfully.

Review notes and departmental decisions are saved with their own explicit Record actions; Save draft saves capture fields. Use Refresh evidence and reviews after an uncertain response before repeating a mutation.

## Concurrency and exceptions

A version conflict keeps local capture data in place. Reopen the current saved draft and reconcile deliberately; do not overwrite another officer's version. Readiness checks reject a form-version mismatch rather than presenting results for a different saved version. Departmental drafts keep the review timestamp from when editing started, even if the register is refreshed. On a conflict, the note is retained and Reload selected section explicitly reloads the current decision. Existing server-side project membership and write/review permissions remain authoritative.

Scanner failures, unknown availability and failed register requests never count as verified or complete. No background retry repeats a case write or document storage mutation after an uncertain commit.

## Operator checks

Before a controlled test session, confirm project membership, save/reopen a synthetic draft and check document service availability if an upload is unavailable. Review scan retries and returned items on the dashboard. Keep department decisions with their assigned reviewers. Resolve provisional rule ownership and operational support before authorising production use.

Domain onboarding and cutover checks are in [DOMAIN_SETUP.md](DOMAIN_SETUP.md).
