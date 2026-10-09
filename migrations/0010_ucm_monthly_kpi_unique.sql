-- Required by the UCM monthly upsert on legacy portal databases.
-- Non-destructive: no account, call, manual KPI or archive is removed.
CREATE UNIQUE INDEX IF NOT EXISTS agent_kpi_monthly_username_period_ucm
ON agent_kpi_monthly(username,period_start);
