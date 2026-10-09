# Live queue login and attendance

Admin → UCM operations shows UCM extension, queue, login timestamp, and
explicit portal mapping. Wave account sign-in is not queue login. When UCM
does not report a login timestamp, attendance is not invented. If the queue
has `enable_agent_login=no`, enable queue login in UCM if attendance must
depend on an explicit queue login (review this PBX change with its admin).

Install the verified `windows/Enable-UcmLiveQueues.ps1` update as Administrator
on the existing connector PC. It preserves credentials, TLS certificate pin,
and pending login/logout events. Keep the scheduled connector task running.
Numeric usernames now link automatically to the identical UCM extension,
including newly created active agent/quality/trainer accounts. Explicit manual
mappings override this default; disabled mappings block automatic fallback.
Non-numeric usernames or different extension numbers require a manual mapping.
Automatic mappings are resolved on reads/events, not stored as recurring writes.

The connector forwards genuine login/logout transitions, plus one sanitized
current-state snapshot on membership changes, coalesced for 500 ms. It sends
a connection heartbeat every 90 seconds only after a queue snapshot is seen.
No CDR imports, monthly sync, pause history, call payloads, or passwords are
sent by this mode. The server stores one latest snapshot (not heartbeat
history); signed packet replay cannot extend its freshness. Out-of-order
snapshots cannot overwrite newer ones.

The admin checks every 10 seconds only while UCM operations is visible. Reads
use a short shared cache and conditional responses. Unchanged memberships
retain their DOM. After 180 seconds without a connector snapshot, status is
labelled stale, not presented as current login. This is bounded polling,
not a push WebSocket in the browser.

First verified queue login creates HR attendance automatically. A fresh
snapshot reconciles real login timestamps after restarts and mapping changes.
HR corrections/deletions remain authoritative; unknown timestamps never
create a check-in. Browser check-in remains disabled in queue-login mode.

## Cost boundary

The heartbeat alone makes about 28,800 snapshot writes in a 30-day month
with one connector running continuously. Actual transitions add writes.
A continuously visible admin tab makes about 259,200 requests per 30 days;
hidden or inactive tabs make none for this feature. These are feature-only
estimates, not whole-account billing measurements or a hard spending cap.

Workers Paid has a $5/month minimum with included usage and chargeable
overages. Account-wide Workers, D1, R2, and other usage must be monitored in
Cloudflare Billing. No subscription or billing plan is changed by this update.
A D1 quota error backs off the connector instead of hammering retries; saved
login/logout events remain in its local outbox until accepted.
