import { pingBucket, pingDatabase } from "@silver/shared";
import { Router } from "express";
import type { Dependencies } from "../dependencies.js";

export function createHealthRouter({ pool, storage, config }: Dependencies): Router {
  const router = Router();

  router.get("/", async (_request, response) => {
    const failing = await failingComponents([
      ["database", () => pingDatabase(pool)],
      ["storage", () => pingBucket(storage, config.S3_BUCKET)],
    ]);

    if (failing.length > 0) {
      response.status(503).json({ status: "degraded", failing });
      return;
    }

    response.json({ status: "ok" });
  });

  return router;
}

type Component = [name: string, probe: () => Promise<unknown>];

async function failingComponents(components: Component[]): Promise<string[]> {
  const results = await Promise.all(
    components.map(async ([name, probe]) => {
      try {
        await probe();
        return null;
      } catch {
        return name;
      }
    }),
  );
  return results.filter((name): name is string => name !== null);
}
