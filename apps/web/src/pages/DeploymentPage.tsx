import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/Button.js";
import { LogTerminal } from "../components/LogTerminal.js";
import { StatusStepper } from "../components/StatusStepper.js";
import { UrlCard } from "../components/UrlCard.js";
import { api } from "../lib/api.js";
import { useDeployment } from "../lib/useDeployment.js";

export function DeploymentPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { deployment, logs, error, refresh, apply } = useDeployment(id);

  if (error && !deployment) {
    return (
      <div className="text-center">
        <h2 className="text-h2">{error}</h2>
        <Link to="/" className="mt-4 inline-block text-small text-text-dim underline underline-offset-4">
          Deploy something
        </Link>
      </div>
    );
  }

  if (!deployment) {
    return <p className="text-center text-small text-text-dim">Loading…</p>;
  }

  const { status } = deployment;

  return (
    <div className="flex w-full flex-col gap-6">
      <StatusStepper status={status} errorMessage={deployment.errorMessage} />

      {status === "READY" && <UrlCard deployment={deployment} />}

      {logs.length > 0 && <LogTerminal logs={logs} />}

      <div className="flex flex-wrap gap-2">
        {status === "QUEUED" && (
          <Button onClick={() => void api.cancel(id).then(apply).catch(refresh)}>Cancel</Button>
        )}

        {(status === "FAILED" || status === "CANCELLED") && (
          <Button variant="primary" onClick={() => void api.retry(id).then(apply).catch(refresh)}>
            Retry
          </Button>
        )}

        {(status === "READY" || status === "FAILED" || status === "CANCELLED") && (
          <Button
            onClick={() =>
              void api.redeploy(id).then((next) => navigate(`/d/${next.id}`)).catch(refresh)
            }
          >
            Redeploy
          </Button>
        )}

        <Link
          to="/"
          className="inline-flex h-10 items-center rounded-control px-4 text-small text-text-dim transition-colors duration-150 hover:text-text"
        >
          Drop another
        </Link>
      </div>
    </div>
  );
}
