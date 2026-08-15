-- The sweep looks for three expired statuses, but the index only covered
-- READY, so half the predicate had no support and Postgres fell back to
-- scanning the whole table once an hour, for as long as the table kept growing.
DROP INDEX idx_deployments_expiry;

CREATE INDEX idx_deployments_expiry
    ON deployments (expires_at)
    WHERE status IN ('READY', 'FAILED', 'CANCELLED');
