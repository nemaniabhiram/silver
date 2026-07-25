import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/Button.js";
import { LogTerminal } from "../components/LogTerminal.js";
import { StatusStepper } from "../components/StatusStepper.js";
import { UrlCard } from "../components/UrlCard.js";
import { type DeploymentStatus, api } from "../lib/api.js";
import { useDeployment } from "../lib/useDeployment.js";
import { useDocumentTitle } from "../lib/useDocumentTitle.js";

const TAB_LABEL: Record<DeploymentStatus, string> = {
  QUEUED: "Queued",
  BUILDING: "Building",
  READY: "Live",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

type Action = "cancel" | "retry" | "redeploy";

export function DeploymentPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { deployment, logs, error, refresh, apply } = useDeployment(id);
  const [pending, setPending] = useState<Action | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useDocumentTitle(deployment ? `${TAB_LABEL[deployment.status]} · ${id} · silver` : null);

  /**
   * Actions used to swallow their failures and refresh instead, so cancelling a
   * moment too late looked like a button that did nothing. The refusal is the
   * answer, so it is shown. Holding the button until the request settles keeps
   * an impatient second click from spending another deployment.
   */
  async function run(action: Action, request: () => Promise<void>): Promise<void> {
    setPending(action);
    setActionError(null);

    try {
      await request();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "That didn't work. Try again.");
      await refresh();
    } finally {
      setPending(null);
    }
  }

  if (error && !deployment) {
    return (
      <div className="text-center">
        <h2 className="text-h2">{error}</h2>
        <Link
          to="/"
          className="mt-4 inline-block text-small text-text-dim underline underline-offset-4"
        >
          Deploy something
        </Link>
      </div>
    );
  }

  if (!deployment) {
    return <LoadingSkeleton />;
  }

  const { status } = deployment;
  const busy = pending !== null;

  return (
    <div className="flex w-full flex-col gap-6">
      <StatusStepper status={status} errorMessage={deployment.errorMessage} />

      {status === "READY" && <UrlCard deployment={deployment} />}

      {logs.length > 0 && <LogTerminal logs={logs} />}

      {actionError && (
        <p role="alert" className="text-small text-failed">
          {actionError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {status === "QUEUED" && (
          <Button
            disabled={busy}
            onClick={() => void run("cancel", async () => apply(await api.cancel(id)))}
          >
            {pending === "cancel" ? "Cancelling…" : "Cancel"}
          </Button>
        )}

        {(status === "FAILED" || status === "CANCELLED") && (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void run("retry", async () => apply(await api.retry(id)))}
          >
            {pending === "retry" ? "Retrying…" : "Retry"}
          </Button>
        )}

        {(status === "READY" || status === "FAILED" || status === "CANCELLED") && (
          <Button
            disabled={busy}
            onClick={() =>
              void run("redeploy", async () => {
                const next = await api.redeploy(id);
                navigate(`/d/${next.id}`);
              })
            }
          >
            {pending === "redeploy" ? "Redeploying…" : "Redeploy"}
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

/** Shaped like the stepper and card that replace it, so nothing jumps. */
function LoadingSkeleton() {
  return (
    <div className="flex w-full animate-pulse flex-col gap-6">
      <p role="status" className="sr-only">
        Loading this deployment
      </p>

      <div className="flex items-center gap-3">
        <span className="size-2.5 rounded-full bg-line" />
        <span className="h-3 w-16 rounded-sm bg-line" />
        <span className="h-px flex-1 bg-line" />
        <span className="size-2.5 rounded-full bg-line" />
        <span className="h-3 w-16 rounded-sm bg-line" />
        <span className="h-px flex-1 bg-line" />
        <span className="size-2.5 rounded-full bg-line" />
        <span className="h-3 w-10 rounded-sm bg-line" />
      </div>

      <div className="h-24 rounded-card border border-line bg-surface" />
    </div>
  );
}
