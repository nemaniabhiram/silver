-- A requeued deployment must wait before it is claimed again. Without this the
-- poll loop re-claims immediately and a transient outage burns every attempt in
-- under a second, which is the opposite of what retrying is for.
ALTER TABLE deployments ADD COLUMN available_at timestamptz NOT NULL DEFAULT now();

DROP INDEX idx_deployments_queue;
CREATE INDEX idx_deployments_queue ON deployments (available_at) WHERE status = 'QUEUED';
