import type { Deployment } from "../lib/api.js";
import { Button } from "./Button.js";
import { CopyButton } from "./CopyButton.js";

export function UrlCard({ deployment }: { deployment: Deployment }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-small text-text">{deployment.url}</span>
          <CopyButton value={deployment.url} />
        </div>

        <Button
          variant="primary"
          onClick={() => window.open(deployment.url, "_blank", "noopener")}
        >
          Visit →
        </Button>
      </div>

      <p className="mt-3 text-caption uppercase tracking-[0.05em] text-text-faint">
        {describe(deployment)}
      </p>
    </section>
  );
}

function describe({ outputFileCount, outputSizeBytes, expiresAt }: Deployment): string {
  const size = outputSizeBytes === null ? null : `${Math.max(1, Math.round(outputSizeBytes / 1024))} KB`;
  const files = outputFileCount === null ? null : `${outputFileCount} files`;
  const expiry = `Expires ${new Date(expiresAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;

  return [files, size, expiry].filter(Boolean).join(" · ");
}
