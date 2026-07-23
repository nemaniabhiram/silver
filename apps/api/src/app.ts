import cors from "cors";
import express, { type Express } from "express";
import type { Dependencies } from "./dependencies.js";
import { handleErrors } from "./errors.js";
import { RateLimiter } from "./rate-limit.js";
import { createDeploymentsRouter } from "./routes/deployments.js";
import { createHealthRouter } from "./routes/health.js";

export function createApp(dependencies: Dependencies): Express {
  const app = express();
  const limiter = new RateLimiter();

  app.set("trust proxy", dependencies.config.TRUST_PROXY);
  app.use(cors({ origin: dependencies.config.WEB_ORIGIN }));

  app.use("/healthz", createHealthRouter(dependencies));
  app.use("/deployments", createDeploymentsRouter(dependencies, limiter));

  app.use(handleErrors);

  return app;
}
