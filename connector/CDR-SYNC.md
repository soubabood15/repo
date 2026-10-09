# Automatic UCM call synchronization

The Queue Connector now runs CDR synchronization alongside queue events. It uses
the existing protected environment, API credentials and certificate pin. No new
credentials or database migration are required.

- Today's completed calls: every minute, with a two-minute overlap and stable-ID
  upserts. Receiver timeouts do not advance the checkpoint.
- Current and previous month: one missing completed day per minute, stored in D1.
  A protected `state/cdr-sync.json` file resumes completed days after restart.
- Older months: an authenticated eBook Performance request queues the month.
  The connector imports one day per minute. Completed months are reused.
- Call archives are retained rather than automatically discarded after 90 days.
  Existing administrator retention/deletion controls remain available.
- The Windows machine and Scheduled Task must remain running. Cloudflare cannot
  reach the private UCM directly. No fake call data or manual operational scores
  are generated.

Logs: `ucm_cdr_sync_progress`, `ucm_cdr_sync_ready`, `ucm_cdr_sync_failed`.
Historical imports are gradual; the first catch-up can take an hour or longer.
Pagination failures are not reported as completed imports.
