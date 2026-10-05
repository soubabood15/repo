# HR first phase

Deployment order: apply the database migrations and publish the Worker before publishing the frontend.

```sh
npx wrangler d1 execute trainer-kb --remote --file=migrations/0005_hr_attendance.sql
npx wrangler d1 execute trainer-kb --remote --file=migrations/0006_hr_live_updates.sql
npx wrangler deploy
```

Create accounts or change their roles through Admin → Users & Passwords:

- `hr`: view attendance, online employees, weekly schedules, verbal actions and private sick leave attachments.
- `hr_admin`: same views, plus schedule editing, issuing verbal actions, and approving/rejecting sick leaves.
- `admin`: existing admin access plus all HR permissions. Admin has a link to `hr.html`.

HR accounts log in through eBook and are redirected to HR. Employees (`agent`, `quality`, `trainer`) retain their existing pages and receive attendance buttons on eBook Home. Receipt acknowledgment is explicit, not automatic approval of a warning.

No new secrets. Optional Worker variable `HR_LATE_GRACE_MINUTES` defaults to **0**. Existing D1 `trainer_kb` and private R2 `trainer_kb_files` bindings are required.

Attendance uses server time, Asia/Amman, the same dated `shift_USERNAME_YYYY-MM-DD` entries and weekday fallback used by Live Schedule. OFF/unassigned days are never absence. Overnight shifts belong to their starting day. Open older attendance sessions remain available for closing. First daily punch-in/out are idempotent and cannot be reset by reopening the portal. This is a portal attendance button, **not hardware biometric verification or proof of location**.

HR late/missing/absence notifications appear in the attendance screen and counters. No email/SMS/background push is configured. Online presence and attendance are separate. Sick leave becomes an approved absence exception only after HR Admin approves it. Attachments: PDF/JPEG/PNG with content validation, max 5 MB; private downloads authorize owner or HR on every request. Sensitive HR tables are not exposed through generic REST/storage routes.

HR checks a small revision plus recent presence every 10 seconds while visible and not idle-paused; the full selected week reloads only on change. Employees check one revision row on the same interval; notifications/attendance/leaves load only when it changes. Changes across devices arrive within about 10 seconds, not via an always-open push connection; background tabs check when reopened. Same-browser tabs also receive a BroadcastChannel signal. Punch buttons apply the server response immediately. Dirty schedule cells, verbal-action drafts and selected sick-leave files survive background updates.

HR Admin/admin can permanently delete one verbal action or sick leave after confirmation; HR viewers and employees cannot. Deletion is audited and revision-triggered. Deleted sick-leave attachments are removed from private storage, with a persistent cleanup queue retried by the existing hourly Worker cron if storage is temporarily unavailable. Automated tests do not delete any production records.

```sh
node --test test/hr.test.js
npm test
npm run check
```

After publication: use one HR and one HR Admin account; verify read-only restrictions, save one dated shift, punch in twice/reopen eBook, issue and acknowledge a fixture verbal notice, upload and review a fixture sick leave, and test phone layout. No production attendance or leave is created by automated tests. Existing quality cache work also requires migration `0004_quality_month_revisions.sql` when publishing that feature.
