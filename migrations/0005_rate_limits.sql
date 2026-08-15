-- Fixed window counters, shared by every api instance. Held in one process's
-- memory they meant nothing the moment a second instance existed: each counted
-- alone, so the advertised limit multiplied by however many were running.
--
-- Postgres is already the coordination layer for the queue, the state machine
-- and the logs, so the counters move here rather than to new infrastructure.
CREATE TABLE rate_limits (
    key               text PRIMARY KEY,
    window_started_at timestamptz NOT NULL,
    count             integer NOT NULL
);

-- The sweep deletes by age, and every window is an hour at most.
CREATE INDEX idx_rate_limits_window ON rate_limits (window_started_at);
