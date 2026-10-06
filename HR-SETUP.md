# HR workspace, attendance and time-off requests

Deployment order: apply the database migrations and publish the Worker before publishing the frontend.

```sh
npx wrangler d1 execute trainer-kb --remote --file=migrations/0005_hr_attendance.sql
npx wrangler d1 execute trainer-kb --remote --file=migrations/0006_hr_live_updates.sql
npx wrangler d1 execute trainer-kb --remote --file=migrations/0007_hr_requests.sql
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

Live rendering uses `hr-live-dom.js` to patch text/attributes and keyed employee/request cards in place. Unchanged markup is a no-op; it does not replace containers. Draft forms and selected medical files are never detached, open details/focused controls/request filters are preserved, and loaded analytics stay visible while a changed revision is fetched. Entrance animations run only on deliberate navigation and are cleared after the transition. Background updates do not reload the document or show a loading screen over already loaded data.

HR Admin/admin can permanently delete one verbal action or sick leave after confirmation; HR viewers and employees cannot. Deletion is audited and revision-triggered. Deleted sick-leave attachments are removed from private storage, with a persistent cleanup queue retried by the existing hourly Worker cron if storage is temporarily unavailable. Automated tests do not delete any production records.

The primary HR navigation is a right sidebar with a top toggle, a mobile drawer/backdrop, keyboard Escape and reduced-motion support. All HR controls, Profile request forms and the admin attendance-file analyzer are English. Employee-written names/notes and business knowledge content are not translated.

eBook Home starts with attendance; Profile has separate sick, annual, hourly leave and next-week preference forms, request decisions/history and verbal-action history. `/hr/requests` accepts employee-owned annual/hourly/preferences only. `/hr/requests/:id` reviews/deletes for HR Admin/admin only. `/hr/requests/:id/seen` and `/hr/sick-leaves/:id/seen` acknowledge the owner's decision notification. Employee and HR pages update on the existing revision mechanism without manual refresh; these are in-app notifications, not OS push.

Hourly leave must fit in the actual saved shift (including overnight hours). Approval revalidates the current shift and prevents overlapping approved time off. An approved leave at the shift start adjusts the expected check-in time. Work = the recorded punch interval clipped to the shift minus approved leave overlapping that interval. Required work = scheduled minutes minus approved time off. Leave never creates worked hours. Annual/sick days remove the work requirement, but no entitlement/balance, payroll rule or holiday calendar is invented. If a later schedule change makes hourly leave invalid, it is not deducted and HR should review/recreate it.

Next-week preferences use the next Sunday–Saturday week in Asia/Amman. Submission does not modify any official shift. “Approve & apply week” explicitly writes only the preferred dated shifts; no-preference days are preserved. HR can reject requests instead. Approval decisions are saved and automatically shown to the employee.

`GET /hr/analytics?month=YYYY-MM` is HR-only and queries one month: Agent360 performance reads `agent_kpi_monthly`, with missing scores represented as missing (not zero). Attendance analysis includes real late punches, absence, actions/acknowledgments, annual/sick days, hourly leave and recorded/required work for completed shifts. Past days without a dated saved shift or attendance snapshot are not inferred from today's weekly template. No combined disciplinary/employee-worth score is generated. Analytics is cached for the selected month/revision, with KPI triggers invalidating changes. Profile shows the latest 100 requests per category; HR reviews the selected month plus pending requests, up to 500 per category.

Migration 0007 is additive (no attendance deletion). Apply once using the migration ledger or the command above; it adds a column to sick leaves, so do not rerun it manually. Deploy Worker, then frontend, together. No secrets are added or requested.

```sh
node --test test/hr.test.js
npm test
npm run check
```

After publication: use one HR and one HR Admin account; verify read-only restrictions, save one dated shift, punch in twice/reopen eBook, issue and acknowledge a fixture verbal notice, upload and review a fixture sick leave, and test phone layout. No production attendance or leave is created by automated tests. Existing quality cache work also requires migration `0004_quality_month_revisions.sql` when publishing that feature.
# Attendance records and HR section permissions

Apply `migrations/0008_hr_permissions.sql` before deploying the updated Worker. This additive migration creates per-user HR permissions and the attendance-delete revision trigger. It does not change existing punches or account roles.

- Main Admin: **Attendance records** in the Admin sidebar. Select a month, mark a scheduled employee present, edit check-in/out, or delete that employee's daily punch. Every correction requires a reason and keeps the previous record in `hr_audit`.
- Employee: **Profile → My attendance records**. Choose a month to see punches, absence and missing check-outs. Historical days without a dated schedule or attendance snapshot are not guessed.
- HR: **Attendance records** uses the same monthly data; **Export attendance to Excel** has its own month selector. XLSX uses numeric Excel dates displayed in Amman time, literal employee identifiers, and blank missing punches.
- HR Admin: **HR staff & permissions** creates HR employee accounts and assigns No access / Read / Write for attendance, online employees, schedules, actions, leave, performance, analysis and export. Write includes read. HR staff cannot create accounts or change permissions; HR Admin accounts remain managed by the main Admin.
- Existing HR accounts retain their previous role defaults until explicitly customized. Permissions are checked against the current database record on every HR request and revision changes refresh open pages without rebuilding unchanged cards.
- Employee history fetches only while Profile is open and caches the selected month until the HR revision changes. No production punches or test accounts are created by the migration.
