CREATE TABLE deployment_logs (
    id            bigserial PRIMARY KEY,
    deployment_id text NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    message       text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_logs_deployment ON deployment_logs (deployment_id, id);
