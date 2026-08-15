import { requestId } from "@silver/shared";
import cors from "cors";
import express, { type Express } from "express";
import type { Dependencies } from "./dependencies.js";
import { createErrorHandler } from "./errors.js";
import { RateLimiter } from "./rate-limit.js";
import { createDeploymentsRouter } from "./routes/deployments.js";
import { createHealthRouter } from "./routes/health.js";

export function createApp(dependencies: Dependencies): Express {
  const app = express();
  const limiter = new RateLimiter(dependencies.pool, dependencies.log);

  app.set("trust proxy", dependencies.config.TRUST_PROXY);
  // Without exposing it, CORS hides the request id from the very page that
  // would quote it back to us when something goes wrong.
  app.use(cors({ origin: dependencies.config.WEB_ORIGIN, exposedHeaders: ["X-Request-Id"] }));
  app.use(requestId(dependencies.log));

  app.use("/healthz", createHealthRouter(dependencies));
  app.use("/deployments", createDeploymentsRouter(dependencies, limiter));

  app.use(createErrorHandler(dependencies.log));

  return app;
}
