# ICON7 Padel validation — 2026-10-21

- Inspected the authenticated ICON7 Available Times UI, the booking form and an existing reservation's details without creating or deleting a reservation.
- Confirmed the visible schedule cells use `title` strings for available/reserved times, and the date field is an editable labelled input.
- Added 10 passing tests for Amman date validation, server permissions, device pairing and secret hashing, quote expiry/price validation, idempotency, one-use submission authorization, queue expiry, UI detail verification, and journal recovery after a lost response.
- `npm run check`, the new JavaScript syntax checks and `git diff --check` passed. Worker dry-run packaging passed.
- Full suite during development: 154 passed / 6 failed (160 tests, before the last pairing test was added). A clean HEAD checkout reproduced 5 failures: HR attendance UI fixture, queue attendance mode, CDR pagination, UCM installer manifest hash and a sandbox-restricted TLS listener. The sixth failure involves ebook.html, which already had unrelated local changes when this task started. Those changes were preserved and excluded from this release.
- Visually inspected the Arabic booking UI in Chrome on localhost. Unauthenticated access correctly asks for eBook sign-in.
- Applied only migrations/0016_icon7_padel.sql to the existing D1 database. Deployed the Worker with version 9943d1a7-9846-4b30-8aa0-627b164631e7. Verified `/health` returns 200 and both new employee and connector routes return 401 without credentials.
- The Windows archive contains source, the locked npm dependency manifest, setup/login/check/start commands and Arabic instructions. It contains no browser profile, device secret or customer records.

Still required on the actual Windows device: install Node.js, pair from an administrator's ICON7 page, sign in to ICON7 in the dedicated browser, run the connection check, then validate a real booking agreed by the operator. The automated browser adapter has not yet been run end-to-end against a real booking; no successful live booking is claimed.

Publication verified: the hosted icon7.html contains the booking button, the booking script and Windows ZIP return HTTP 200, and the authenticated booking panel opens inside the live ICON7 page. Its status correctly shows that the Windows device is not connected; the employee history request succeeds. The original ebook.html working changes were not published.

Original interface restoration: user.html and admin.html were restored byte-for-byte from html-interfaces.zip. No CSS or layout changes were made to the supplied documents. Booking behavior is attached after iframe load, and the duplicate outer headings/tabs/notices were removed. Browser QA used an isolated localhost fixture to load slots, open the booking modal, submit a synthetic local-only booking, show its result, and navigate to the original admin design. No booking request was sent to ICON7 in this QA. Device pairing is now under the existing PADELBOOK profile control.
