# Quality change-only refresh

Before deploying the updated Worker/frontend, apply the idempotent migration:

```sh
npx wrangler d1 execute trainer-kb --remote --file=migrations/0004_quality_month_revisions.sql
```

The triggers update a small month revision marker inside the same transaction as an evaluation insert, edit or deletion. Moving an evaluation invalidates both old and new months. No existing evaluations or historical manual QA records are removed by this migration.

QA Tracker and admin Quality Calls keep account-scoped month caches. Reopening an unchanged historical month reads the cache, without re-downloading its evaluations. Cached entries have no time-based expiry; the browser keeps up to 16 recent month/employee selections and clears the current account's cache on logout. Storage quota failures fall back to in-memory caching.

Only while QA Tracker or Quality Calls is visible, a once-per-minute authenticated request checks the small revision map. Payloads are fetched only for a changed selected month. Same-browser Quality saves trigger an immediate revision check. Switching employees filters the already-loaded monthly calls locally.

Presence monitoring, pending access-request checks and authentication are separate from historical evaluation data and remain active. The revision endpoint requires admin authorization and refuses to enable caching if the migration marker is absent. Tokens/passwords are never stored in the cache.
