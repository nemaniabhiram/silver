import { type Config, type Deployment, deploymentUrl } from "@silver/shared";

export interface DeploymentResource {
  id: string;
  status: string;
  url: string;
  requestedPreset: string | null;
  detectedPreset: string | null;
  sourceSizeBytes: number;
  outputSizeBytes: number | null;
  outputFileCount: number | null;
  errorMessage: string | null;
  attemptCount: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  buildDurationMs: number | null;
  expiresAt: string;
}

export function toDeploymentResource(
  deployment: Deployment,
  config: Config,
): DeploymentResource {
  return {
    id: deployment.id,
    status: deployment.status,
    url: deploymentUrl(deployment.id, config),
    requestedPreset: deployment.requestedPreset,
    detectedPreset: deployment.detectedPreset,
    sourceSizeBytes: deployment.sourceSizeBytes,
    outputSizeBytes: deployment.outputSizeBytes,
    outputFileCount: deployment.outputFileCount,
    errorMessage: deployment.errorMessage,
    attemptCount: deployment.attemptCount,
    createdAt: deployment.createdAt.toISOString(),
    startedAt: deployment.startedAt?.toISOString() ?? null,
    finishedAt: deployment.finishedAt?.toISOString() ?? null,
    buildDurationMs: deployment.buildDurationMs,
    expiresAt: deployment.expiresAt.toISOString(),
  };
}
