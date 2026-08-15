import { useCallback, useEffect, useRef, useState } from "react";
import { type Deployment, type LogLine, api, eventsUrl, isInProgress } from "./api.js";

const POLL_INTERVAL_MS = 2000;

/** Enough failures in a row to conclude the stream is not coming back. */
const STREAM_ATTEMPTS = 3;

type Transport = "stream" | "poll";

interface DeploymentView {
  deployment: Deployment | null;
  logs: LogLine[];
  error: string | null;
  refresh: () => Promise<void>;
  apply: (next: Deployment) => void;
}

/**
 * Follows a deployment until it reaches a state it will not leave on its own.
 *
 * Updates are streamed when the browser and the network allow it, which is
 * every log line and status change arriving as it happens rather than up to two
 * seconds later. Polling stays as the fallback: a proxy that buffers the stream
 * would otherwise leave the page silent, and that cannot be tested from here.
 */
export function useDeployment(id: string): DeploymentView {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<Transport>(
    typeof EventSource === "undefined" ? "poll" : "stream",
  );
  const lastLogId = useRef(0);

  const appendLogs = useCallback((incoming: LogLine[]) => {
    if (incoming.length === 0) {
      return;
    }
    lastLogId.current = Math.max(lastLogId.current, ...incoming.map((line) => Number(line.id)));
    setLogs((previous) => [...previous, ...incoming]);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [next, newLogs] = await Promise.all([api.get(id), api.logs(id, lastLogId.current)]);

      setDeployment(next);
      setError(null);
      appendLogs(newLogs.logs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    }
  }, [id, appendLogs]);

  useEffect(() => {
    lastLogId.current = 0;
    setLogs([]);
    setDeployment(null);
    setTransport(typeof EventSource === "undefined" ? "poll" : "stream");
  }, [id]);

  // Depending on the whole deployment would rebuild these effects on every
  // update, since each response is a new object. The status is the only part
  // that decides whether there is still anything to wait for.
  const status = deployment?.status;
  const settled = status !== undefined && !isInProgress(status);

  useEffect(() => {
    if (transport !== "stream" || settled) {
      return;
    }

    // The browser resends Last-Event-ID on its own reconnects, but a fresh page
    // load has no header to send, so the cursor starts in the query.
    const source = new EventSource(eventsUrl(id, lastLogId.current));
    let failures = 0;

    source.addEventListener("log", (event) => {
      appendLogs([JSON.parse((event as MessageEvent<string>).data) as LogLine]);
      setError(null);
    });

    source.addEventListener("status", (event) => {
      setDeployment(JSON.parse((event as MessageEvent<string>).data) as Deployment);
      setError(null);
    });

    source.addEventListener("open", () => {
      failures = 0;
    });

    source.addEventListener("error", () => {
      failures += 1;
      if (failures >= STREAM_ATTEMPTS) {
        source.close();
        setTransport("poll");
      }
    });

    return () => source.close();
  }, [id, transport, settled, appendLogs]);

  // One read when the deployment changes, whichever transport is in use. The
  // stream replays everything on connect, but a deployment that does not exist
  // has to say so now rather than after EventSource has finished retrying.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (transport !== "poll" || settled) {
      return;
    }

    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [transport, settled, refresh]);

  return { deployment, logs, error, refresh, apply: setDeployment };
}
