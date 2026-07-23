import type { DeploymentStatus } from "@silver/shared";
import type pg from "pg";

interface CacheEntry {
  status: DeploymentStatus | null;
  readAt: number;
}

const TTL_MS = 60_000;
const MAX_ENTRIES = 1_000;

/**
 * A site is many requests but one deployment. Caching the status keeps asset
 * traffic off Postgres — one read per site per minute rather than per file.
 */
export class DeploymentLookup {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly pool: pg.Pool) {}

  async statusOf(deploymentId: string, now: number = Date.now()): Promise<DeploymentStatus | null> {
    const cached = this.cache.get(deploymentId);
    if (cached && now - cached.readAt < TTL_MS) {
      return cached.status;
    }

    const result = await this.pool.query<{ status: DeploymentStatus }>(
      "SELECT status FROM deployments WHERE id = $1",
      [deploymentId],
    );

    const status = result.rows[0]?.status ?? null;
    this.remember(deploymentId, { status, readAt: now });
    return status;
  }

  private remember(deploymentId: string, entry: CacheEntry): void {
    if (this.cache.size >= MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) {
        this.cache.delete(oldest.value);
      }
    }
    this.cache.set(deploymentId, entry);
  }
}
