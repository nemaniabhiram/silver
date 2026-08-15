import { type Config, DEPLOYMENT_EVENTS_CHANNEL, type Logger } from "@silver/shared";
import pg from "pg";

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface Subscriber {
  wake: () => void;
  ip: string;
}

/**
 * Who is watching which deployment. A notification names one deployment, so
 * only the people looking at that one are woken and everything else costs
 * nothing.
 */
export class DeploymentEvents {
  private readonly watchers = new Map<string, Set<Subscriber>>();

  subscribe(deploymentId: string, ip: string, wake: () => void): () => void {
    const subscriber: Subscriber = { wake, ip };
    const existing = this.watchers.get(deploymentId) ?? new Set<Subscriber>();
    existing.add(subscriber);
    this.watchers.set(deploymentId, existing);

    return () => {
      existing.delete(subscriber);
      if (existing.size === 0) {
        this.watchers.delete(deploymentId);
      }
    };
  }

  notify(deploymentId: string): void {
    for (const subscriber of this.watchers.get(deploymentId) ?? []) {
      subscriber.wake();
    }
  }

  /** Streams held open by one address, which is what admission is capped on. */
  streamsFrom(ip: string): number {
    let count = 0;
    for (const subscribers of this.watchers.values()) {
      for (const subscriber of subscribers) {
        if (subscriber.ip === ip) {
          count += 1;
        }
      }
    }
    return count;
  }
}

export interface EventListener {
  stop(): Promise<void>;
}

/**
 * Listens on the one channel the rest of the system announces on and hands each
 * notification to the registry.
 *
 * The connection is deliberately its own client rather than one from the pool:
 * LISTEN occupies a connection for as long as it is listening, and the pool is
 * five wide and shared with every ordinary query.
 *
 * It reconnects, and that matters more here than anywhere else in the system.
 * A long-lived idle connection is the most exposed thing there is to Postgres
 * restarting, and an unheard error event on one is what took the worker down
 * before it was given a handler.
 */
export function startEventListener(
  config: Config,
  log: Logger,
  events: DeploymentEvents,
): EventListener {
  let client: pg.Client | null = null;
  let stopped = false;
  let backoffMs = RECONNECT_MIN_MS;
  let retry: NodeJS.Timeout | null = null;

  function scheduleReconnect(): void {
    if (stopped || retry) {
      return;
    }

    retry = setTimeout(() => {
      retry = null;
      void connect();
    }, backoffMs);
    retry.unref();

    backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
  }

  async function connect(): Promise<void> {
    if (stopped) {
      return;
    }

    const attempt = new pg.Client({ connectionString: config.DATABASE_URL });

    attempt.on("error", (error) => {
      log.warn("event listener lost its connection", { err: error.message });
      client = null;
      scheduleReconnect();
    });

    attempt.on("notification", (message) => {
      if (message.payload) {
        events.notify(message.payload);
      }
    });

    try {
      await attempt.connect();
      await attempt.query(`LISTEN ${DEPLOYMENT_EVENTS_CHANNEL}`);
      client = attempt;
      backoffMs = RECONNECT_MIN_MS;
      log.info("listening for deployment events");
    } catch (error) {
      log.warn("event listener could not connect", {
        err: error instanceof Error ? error.message : "unknown",
      });
      await attempt.end().catch(() => undefined);
      scheduleReconnect();
    }
  }

  void connect();

  return {
    async stop() {
      stopped = true;
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      await client?.end().catch(() => undefined);
      client = null;
    },
  };
}
