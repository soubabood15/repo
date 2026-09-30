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

## TLS and connector

Install the UCM's issuing CA and pass it through `NODE_EXTRA_CA_CERTS`. Never use `NODE_TLS_REJECT_UNAUTHORIZED=0` in production. The connector uses challenge → MD5(challenge + password) → login and a heartbeat only while connected.

## Rollback

Disable CDR Real-Time Output and stop the optional connector. Existing eBook features continue to work. Roll back Worker/static files to the preceding deployment. The new tables are isolated; retain them for audit or export them before dropping.

After exporting any required audit data, `migrations/0002_ucm_integration.rollback.sql` removes only the UCM integration tables.
