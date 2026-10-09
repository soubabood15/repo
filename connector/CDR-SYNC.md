# Automatic UCM call synchronization

The Queue Connector now runs CDR synchronization alongside queue events. It uses
the existing protected environment, API credentials and certificate pin. No new
credentials or database migration are required.

- Completed calls: once per Amman calendar day, including a two-day overlap for
  overnight/late-ending calls and stable-ID upserts. Failures retry after five
  minutes. Already completed daily runs do not query UCM again on restart.
- Current and previous month: all missing completed days import sequentially in
  the daily run, stored in D1.
  A protected `state/cdr-sync.json` file resumes completed days after restart.
- Older months: an authenticated eBook Performance request queues the month.
  Jobs are checked every five minutes; requested days import sequentially.
- On month rollover, retain the current and preceding month. Older UCM calls,
  queue events, daily totals and automatic KPI are deleted only after successful
  preceding-month delivery. Manual KPI, HR, schedules and quality data remain.
  An older month requested on demand is retained until the next monthly rotation,
  and can be requested again afterward.
- The Windows machine and Scheduled Task must remain running. Cloudflare cannot
  reach the private UCM directly. No fake call data or manual operational scores
  are generated.

Logs: `ucm_cdr_sync_progress`, `ucm_cdr_daily_complete`, `ucm_cdr_sync_failed`.
Historical imports are gradual; a large first catch-up may take some time.
Pagination failures are not reported as completed imports.
