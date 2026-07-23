import { useCallback, useEffect, useRef, useState } from "react";
import { type Deployment, type LogLine, api, isInProgress } from "./api.js";

const POLL_INTERVAL_MS = 2000;

interface DeploymentView {
  deployment: Deployment | null;
  logs: LogLine[];
  error: string | null;
  refresh: () => Promise<void>;
  apply: (next: Deployment) => void;
}

/**
 * Polls status and logs while there is something to wait for, and stops once
 * the deployment reaches a state it will not leave on its own.
 */
export function useDeployment(id: string): DeploymentView {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastLogId = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const [next, newLogs] = await Promise.all([
        api.get(id),
        api.logs(id, lastLogId.current),
      ]);

      setDeployment(next);
      setError(null);

      if (newLogs.logs.length > 0) {
        lastLogId.current = newLogs.lastId;
        setLogs((previous) => [...previous, ...newLogs.logs]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    }
  }, [id]);

  useEffect(() => {
    lastLogId.current = 0;
    setLogs([]);
    setDeployment(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (deployment && !isInProgress(deployment.status)) {
      return;
    }

    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [deployment, refresh]);

  return { deployment, logs, error, refresh, apply: setDeployment };
}
