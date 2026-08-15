import type { Server } from "node:http";
import type { Logger } from "./logger.js";

const FORCE_EXIT_MS = 10_000;

/**
 * Stops accepting connections, lets the requests already in flight finish, then
 * releases whatever the service is holding. Without this a `docker stop` cuts
 * an upload or a download mid-transfer instead of draining it.
 *
 * `release` is where a service closes its pool and its storage client. It runs
 * once, after the server is closed, and a failure there is logged rather than
 * thrown: the process is on its way out either way.
 */
export function shutdownOnSignal(
  logger: Logger,
  server: Server,
  release: () => Promise<void>,
): void {
  let closing = false;

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (closing) {
        return;
      }
      closing = true;
      logger.info("draining", { signal });

      const giveUp = setTimeout(() => {
        logger.error("gave up waiting for in-flight requests");
        process.exit(1);
      }, FORCE_EXIT_MS);
      giveUp.unref();

      server.close(() => void finish());

      // Keep-alive sockets sitting idle between requests are not in flight, and
      // waiting out their timeout would stall every shutdown by seconds.
      server.closeIdleConnections();
    });
  }

  async function finish(): Promise<void> {
    try {
      await release();
    } catch (error) {
      logger.error("could not release its resources", error);
    }

    logger.info("stopped");
  }
}
