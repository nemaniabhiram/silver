import cors from "cors";
import express, { type Express } from "express";
import type { Dependencies } from "./dependencies.js";
import { createHealthRouter } from "./routes/health.js";

export function createApp(dependencies: Dependencies): Express {
  const app = express();

  app.set("trust proxy", dependencies.config.TRUST_PROXY);
  app.use(cors({ origin: dependencies.config.WEB_ORIGIN }));
  app.use("/healthz", createHealthRouter(dependencies));

  return app;
}
