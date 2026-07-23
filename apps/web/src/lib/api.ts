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
  /**
   * Uses XMLHttpRequest rather than fetch, which reports nothing about a
   * request body as it goes — and a 50 MB upload with no sign of movement
   * looks broken.
   */
  deploy(archive: Blob, onProgress?: (fraction: number) => void): Promise<Deployment> {
    const form = new FormData();
    form.append("file", archive, "site.zip");

    return new Promise((resolve, reject) => {
      const transfer = new XMLHttpRequest();
      transfer.open("POST", `${API_URL}/deployments`);

      transfer.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          onProgress?.(event.loaded / event.total);
        }
      });

      transfer.addEventListener("load", () => {
        const body: unknown = parse(transfer.responseText);

        if (transfer.status >= 200 && transfer.status < 300) {
          resolve(body as Deployment);
          return;
        }

        const error = (body as { error?: { code: string; message: string } } | null)?.error;
        reject(new ApiError(error?.code ?? "INTERNAL", error?.message ?? "Something went wrong."));
      });

      transfer.addEventListener("error", () =>
        reject(new ApiError("OFFLINE", "Couldn't reach Silver. Check your connection.")),
      );
      transfer.addEventListener("abort", () =>
        reject(new ApiError("ABORTED", "That upload was cancelled.")),
      );

      transfer.send(form);
    });
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

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const IN_PROGRESS: readonly DeploymentStatus[] = ["QUEUED", "BUILDING"];

export function isInProgress(status: DeploymentStatus): boolean {
  return IN_PROGRESS.includes(status);
}
