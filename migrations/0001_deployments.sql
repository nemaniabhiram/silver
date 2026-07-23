CREATE TABLE deployments (
    id                 text PRIMARY KEY,
    status             text NOT NULL DEFAULT 'QUEUED'
                       CHECK (status IN ('QUEUED','BUILDING','READY','FAILED','CANCELLED','EXPIRED')),
    requested_preset   text,
    detected_preset    text,
    source_key         text NOT NULL,
    source_size_bytes  bigint NOT NULL,
    output_size_bytes  bigint,
    output_file_count  integer,
    artifact_checksum  text,
    attempt_count      integer NOT NULL DEFAULT 0,
    max_attempts       integer NOT NULL DEFAULT 3,
    error_message      text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    started_at         timestamptz,
    finished_at        timestamptz,
    build_duration_ms  integer,
    expires_at         timestamptz NOT NULL
);

CREATE INDEX idx_deployments_queue  ON deployments (created_at) WHERE status = 'QUEUED';
CREATE INDEX idx_deployments_expiry ON deployments (expires_at) WHERE status = 'READY';
CREATE INDEX idx_deployments_stale  ON deployments (started_at) WHERE status = 'BUILDING';
