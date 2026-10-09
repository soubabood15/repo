# UCM6300A integration

## Architecture

- CDR final records: UCM **CDR Real-Time Output** sends HTTPS JSON directly to `/integrations/ucm/cdr` using Basic credentials stored as Worker secrets.
- Queue events: use a supported UCM WebSocket event report when the installed firmware exposes Login/Logout/Pause/Unpause. The optional `connector/ucm-queue-connector.mjs` runs outbound-only on an existing computer inside the PBX network. It does not expose the UCM. Pending real events are saved in a protected JSON outbox, not a substitute operational database.
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

Grandstream's `cdrapi` successful response may be direct JSON `cdr_root` without
a `status` envelope. v7 accepts that documented structure, still rejects explicit
error statuses and unrecognized objects, and expands numbered `sub_cdr_x` legs
instead of counting the `main_cdr` summary twice. Source-page offsets use CDR
group counts. Session plus AcctId distinguishes detailed legs for idempotent
upserts. Reference: https://documentation.grandstream.com/knowledge-base/cdr-rec-api/

Run this command later from a machine that can reach both the UCM API and the internet:

```bash
npm run ucm:backfill -- --from=2026-08-01 --to=2026-09-30
```

The command performs HTTPS API challenge/login, requests `/cdrapi` using Digest authentication in pages of at most 1,000 records, then forwards batches to the same idempotent Cloudflare webhook used by real-time output. Re-running the same range is safe because `session`/`AcctId` is upserted.

Required local environment variables are documented in `.env.example`. Use `UCM_CA_FILE` for the private CA. `UCM_ALLOW_SELF_SIGNED_DEV=true` is accepted only outside production for a temporary development test.

Excel/CSV analysis remains separate and cannot publish KPI. Employee KPI, HR performance and the latest reading accept only UCM-sourced records with actual calls. Unknown quality, waiting or handling measurements remain unavailable; queue-only periods have no fabricated call score.

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
4. Roll the Worker/static deployment back to the preceding version. Existing manual records are retained for audit; the current version does not show them as UCM data.

## TLS and connector

Install the UCM's issuing CA and pass it through `NODE_EXTRA_CA_CERTS`. Never use `NODE_TLS_REJECT_UNAUTHORIZED=0` in production. The connector uses challenge → MD5(challenge + password) → login and a heartbeat only while connected.

### Exact-certificate pinning for the Windows Queue Connector

If the issuing CA is unavailable, the Queue Connector and v6 CDR backfill support the
optional `UCM_TLS_FINGERPRINT_SHA256` setting (64 hex digits, optionally separated
by colons). Without it, normal CA validation remains unchanged. Pinning is scoped
to the configured UCM origin; Cloudflare retains normal CA validation.

Obtain and independently confirm the exact leaf-certificate SHA-256 fingerprint
with the UCM administrator (e.g. an authenticated company maintenance channel).
The browser's "Not secure" certificate display and a file fetched from an
unverified network connection are not independent identity verification. Never
automatically accept the first network certificate or copy an unconfirmed pin.
Keep the confirmed pin in the local, ACL-protected `ucm.env`, not in Git.

To inspect the public fingerprint of an existing local certificate, without
opening private keys or credentials:

```powershell
& "C:\Program Files\nodejs\node.exe" ".\connector\ucm-check-connection.mjs" --fingerprint-file "C:\ProgramData\Newtel\UcmConnector\ucm-ca.pem"
```

Use a hostname covered by that certificate's SAN in `UCM_WS_URL` (not an IP
unless the certificate has that exact IP SAN), and its matching HTTPS origin in
`UCM_WS_ORIGIN`. Keep the existing API and Cloudflare credentials unchanged.
After manually setting the verified pin, run the no-login/no-ingest probe:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\connector\windows\Test-UcmConnection.ps1"
```

`UPGRADE_OK` proves the pinned TLS and WebSocket upgrade only, not login or queue
event delivery. Restart `NewtelUcmQueueConnector`, then verify `ucm_connected`
and `ucm_queue_subscribed`, then test real queue events. `cloudflare_event_delivered`
confirms the receiver accepted an event. Failure codes are logged without addresses/cookies.
The UCM-scoped agent withholds the socket until pin, hostname and validity checks
pass; redirects are disabled and Cloudflare retains normal CA validation.

Automatic UCM certificate renewal **will change the pin** and intentionally stop
the connector. Obtain and independently confirm the replacement certificate's
fingerprint before updating the local setting. Never disable renewal/security
checks to keep an old pin working. To return to CA mode, remove the pin setting
and install the proper issuing CA, then restart. Do not disable global TLS checks.

## Rollback

## v6 reliable delivery and source enforcement

Apply additive migration `0009_ucm_ingest_receipts.sql` before deploying the Worker.
Update the Windows package to v6 before restarting the task. Existing credentials
and the confirmed certificate pin remain in ProgramData; do not overwrite them.
Old queue connectors are rejected because they do not sign delivery requests.

Each queue request uses Basic authentication plus a 13-digit millisecond timestamp,
a unique nonce, and HMAC-SHA256 of `timestamp.nonce.body` using the existing ingest
password. Timestamps must be within five minutes; nonce reuse returns 409.
Identical successfully processed payloads are acknowledged without recalculation.
Native UCM CDR output retains Basic authentication, with stable record IDs and
payload deduplication. Keep the Windows clock synchronized.

Outbox delivery is serialized and retries independently of new queue messages.
Subscription rejection and phase timeouts are explicit, rather than treating
WebSocket login as successful queue reporting. Raw naive UCM timestamps are
interpreted in Asia/Amman (+03:00). Tables are synchronization storage only:
manual REST publishing into CDR, queue, daily and monthly KPI is disabled.

Run `05-BACKFILL-KPI.bat` for a chosen range to fetch retained CDR directly from
the UCM API. v6 derives missing API/CDR endpoint settings from existing WebSocket
and queue URLs, so existing credentials need not be re-entered. This is a
one-time backfill, not automatic live CDR polling. Enable native UCM CDR Real-Time
Output for continuous final-call delivery. An API permission rejection is a
failure, never an empty successful report.

## Rollback procedure

Disable CDR Real-Time Output and stop the optional connector. Existing eBook features continue to work. Roll back Worker/static files to the preceding deployment. The new tables are isolated; retain them for audit or export them before dropping.

After exporting any required audit data, `migrations/0002_ucm_integration.rollback.sql` removes only the UCM integration tables.
