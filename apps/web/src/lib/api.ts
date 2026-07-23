const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type DeploymentStatus =
  | "QUEUED"
  | "BUILDING"
  | "READY"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export interface Deployment {
  id: string;
  status: DeploymentStatus;
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

export interface LogLine {
  id: string;
  message: string;
  createdAt: string;
}

/** The api writes its messages for people, so components render them unedited. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError("OFFLINE", "Couldn't reach Silver. Check your connection.");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = (body as { error?: { code: string; message: string } } | null)?.error;
    throw new ApiError(error?.code ?? "INTERNAL", error?.message ?? "Something went wrong.");
  }

  return response.json() as Promise<T>;
}

export const api = {
  deploy(archive: Blob): Promise<Deployment> {
    const form = new FormData();
    form.append("file", archive, "site.zip");
    return request<Deployment>("/deployments", { method: "POST", body: form });
  },

  get(id: string): Promise<Deployment> {
    return request<Deployment>(`/deployments/${id}`);
  },

  logs(id: string, afterId: number): Promise<{ logs: LogLine[]; lastId: number }> {
    return request(`/deployments/${id}/logs?afterId=${afterId}`);
  },

  retry(id: string): Promise<Deployment> {
    return request<Deployment>(`/deployments/${id}/retry`, { method: "POST" });
  },

  cancel(id: string): Promise<Deployment> {
    return request<Deployment>(`/deployments/${id}/cancel`, { method: "POST" });
  },

  redeploy(id: string): Promise<Deployment> {
    return request<Deployment>(`/deployments/${id}/redeploy`, { method: "POST" });
  },
};

export const IN_PROGRESS: readonly DeploymentStatus[] = ["QUEUED", "BUILDING"];

export function isInProgress(status: DeploymentStatus): boolean {
  return IN_PROGRESS.includes(status);
}
