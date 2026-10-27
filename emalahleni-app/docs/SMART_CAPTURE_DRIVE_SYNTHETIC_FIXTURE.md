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
