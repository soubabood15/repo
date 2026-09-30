# UCM6300A integration

## Architecture

- CDR final records: UCM **CDR Real-Time Output** sends HTTPS JSON directly to `/integrations/ucm/cdr` using Basic credentials stored as Worker secrets.
- Queue events: use a supported UCM WebSocket event report when the installed firmware exposes Login/Logout/Pause/Unpause. The optional `connector/ucm-queue-connector.mjs` runs outbound-only on an existing computer inside the PBX network. It does not expose the UCM or keep a local database.
- Cloudflare normalizes and upserts by the stable CDR `session`/`AcctId`/`uniqueid`, then recalculates only the affected agent/day.
- Dashboards query the daily aggregate and a small change cursor. They never download all CDR records.
- Raw CDR and queue events default to 90 days (`UCM_RAW_RETENTION_DAYS`); daily aggregates remain available. Failed-ingest metadata is retained for 14 days and never stores the original call payload.

The target appliance was verified as **UCM6300A V1.1A running 1.0.33.30** (Boot/Core/Base/Program). Grandstream documents CDR Real-Time Output for UCM630xA firmware 1.0.5.4 and later, so this firmware is compatible. It can deliver JSON over HTTP/HTTPS and buffers up to 10,000 records during receiver downtime. This release also exposes the current HTTPS/WebSocket API family and queue-agent operations; validate the actual event-report payload once against this appliance before enabling the optional connector.

## UCM setup

1. Apply `migrations/0002_ucm_integration.sql` to D1.
2. Add Worker secrets from `.env.example` with `wrangler secret put`; never place real values in files.
3. In UCM: **Integrations / API Configuration / CDR Real-Time Output Settings**.
4. Enable output, choose HTTPS + JSON, and set the Cloudflare endpoint to `https://<worker>/integrations/ucm/cdr`.
5. Configure the same webhook username/password stored in `UCM_INGEST_USERNAME` and `UCM_INGEST_PASSWORD`.
6. Map each extension to an eBook username in `ucm_agent_mapping`.

## Historical backfill

Run this command later from a machine that can reach both the UCM API and the internet:

```bash
npm run ucm:backfill -- --from=2026-08-01 --to=2026-09-30
```

The command performs HTTPS API challenge/login, requests `/cdrapi` using Digest authentication in pages of at most 1,000 records, then forwards batches to the same idempotent Cloudflare webhook used by real-time output. Re-running the same range is safe because `session`/`AcctId` is upserted.

Required local environment variables are documented in `.env.example`. Use `UCM_CA_FILE` for the private CA. `UCM_ALLOW_SELF_SIGNED_DEV=true` is accepted only outside production for a temporary development test.

Excel/CSV import remains available in KPI Analyzer for historical periods when the UCM no longer retains the requested CDR.

## Production verification inside the company network

The two CDR paths are intentionally separate:

- `8089`: the current HTTPS API. It authenticates with challenge/login, maintains a session cookie in memory, and can execute the `cdrapi` action when the installed API permissions expose it.
- `8443`: the legacy CDR/REC service. Firmware 1.0.16.20+ requires HTTP Digest authentication. It may be disabled even when the new API is enabled.

`UCM_CDR_MODE=auto` tries legacy 8443 first and falls back to authenticated `cdrapi` on 8089. Use `session` or `legacy` to force one route during diagnosis.

Commands (outputs contain status and counts only, never credentials/cookies/customer numbers):

```bash
node connector/ucm-verify.mjs health
node connector/ucm-verify.mjs login
node connector/ucm-verify.mjs sample 2026-09-07T00:00:00+03:00 2026-09-30T23:59:59+03:00
npm run ucm:backfill -- --from=2026-09-07T00:00:00+03:00 --to=2026-09-30T23:59:59+03:00
node connector/ucm-queue-connector.mjs
```

For a completed-call test, place one queue call, answer it, speak briefly, and hang up. Verify the CDR webhook sync cursor changes, the Admin UCM daily row increments once, the agent card updates, and KPI Analyzer shows the same totals. Repeat delivery of the same fixture/session and confirm totals do not increase.

For attendance, use the normal queue login method, then Pause, Unpause, and Logout. Confirm the Admin event order and that the agent card follows the state. Compare first Login and final Logout with the manual shift. Replaying the same `CallQueueStatus` snapshot must not create another event or alert.

Admin verification queries (run with Wrangler inside the authorized operator environment):

```bash
npx wrangler d1 execute trainer-kb --remote --command "SELECT key,status,error_message,updated_at FROM ucm_sync_state;"
npx wrangler d1 execute trainer-kb --remote --command "SELECT day,username,attendance_status,total_calls,answered_calls,updated_at FROM ucm_agent_daily ORDER BY day DESC,username LIMIT 50;"
npx wrangler d1 execute trainer-kb --remote --command "SELECT username,period_start,period_end,total_calls,kpi_score,updated_at FROM agent_kpi_monthly ORDER BY updated_at DESC LIMIT 50;"
```

### Windows company computer (primary)

Install Node.js LTS and copy the project to a permanent local path. Copy `connector/windows/ucm.env.example` to `C:\ProgramData\Newtel\UcmConnector\ucm.env`, fill it locally, and never send or commit that file. Then open Windows PowerShell as Administrator in the project directory:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\connector\windows\Install-UcmQueueConnector.ps1
.\connector\windows\Get-UcmQueueConnectorStatus.ps1
```

The installer locates and validates `node.exe`, restricts the environment-file ACL, registers `NewtelUcmQueueConnector` under SYSTEM at startup, restarts it every minute after failure, and writes only the connector's sanitized JSON status messages to `C:\ProgramData\Newtel\UcmConnector\logs`. To use a nonstandard Node installation, pass `-NodePath 'C:\full\path\node.exe'`.

Safe stop and uninstall (the secret file and logs are deliberately retained):

```powershell
.\connector\windows\Uninstall-UcmQueueConnector.ps1
```

### macOS alternative

For automatic startup on a company Mac, keep secrets in `/etc/newtel/ucm.env` owned by root with mode `600`. Create `/usr/local/newtel/run-ucm-queue.sh` to source that file and execute the connector, also owned by root and not committed. Copy `connector/com.newtel.ucm-queue.plist.example` to `/Library/LaunchDaemons/com.newtel.ucm-queue.plist`, adjust only the non-secret project path, then load it with `sudo launchctl bootstrap system /Library/LaunchDaemons/com.newtel.ucm-queue.plist`.

Safe stop/rollback:

1. `sudo launchctl bootout system /Library/LaunchDaemons/com.newtel.ucm-queue.plist`.
2. Disable CDR Real-Time Output on the UCM.
3. Leave the isolated UCM tables intact for audit, or export them before using the provided rollback migration.
4. Roll the Worker/static deployment back to the preceding version. Existing manual Excel/CSV and published KPI records continue to work.

## TLS and connector

Install the UCM's issuing CA and pass it through `NODE_EXTRA_CA_CERTS`. Never use `NODE_TLS_REJECT_UNAUTHORIZED=0` in production. The connector uses challenge → MD5(challenge + password) → login and a heartbeat only while connected.

## Rollback

Disable CDR Real-Time Output and stop the optional connector. Existing eBook features continue to work. Roll back Worker/static files to the preceding deployment. The new tables are isolated; retain them for audit or export them before dropping.

After exporting any required audit data, `migrations/0002_ucm_integration.rollback.sql` removes only the UCM integration tables.
