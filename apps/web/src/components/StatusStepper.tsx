import type { DeploymentStatus } from "../lib/api.js";

const STEPS = ["Uploaded", "Building", "Live"] as const;

const REACHED: Record<DeploymentStatus, number> = {
  QUEUED: 1,
  BUILDING: 2,
  READY: 3,
  FAILED: 2,
  CANCELLED: 1,
  EXPIRED: 3,
};

const STOPPED: Partial<Record<DeploymentStatus, string>> = {
  FAILED: "text-failed",
  CANCELLED: "text-cancelled",
  EXPIRED: "text-expired",
};

interface StatusStepperProps {
  status: DeploymentStatus;
  errorMessage: string | null;
}

export function StatusStepper({ status, errorMessage }: StatusStepperProps) {
  const reached = REACHED[status];
  const stoppedAt = STOPPED[status] ? reached : null;

  return (
    <div>
      <ol className="flex items-center">
        {STEPS.map((label, index) => {
          const position = index + 1;
          const isStopped = stoppedAt === position;

          return (
            <li key={label} className="flex flex-1 items-center gap-3 last:flex-none">
              <div className="flex items-center gap-2">
                <Node position={position} reached={reached} status={status} stopped={isStopped} />
                <span
                  className={`text-small ${
                    position <= reached ? "text-text" : "text-text-faint"
                  }`}
                >
                  {label}
                </span>
              </div>
              {position < STEPS.length && (
                <span
                  className={`h-px flex-1 ${position < reached ? "bg-text-dim" : "bg-line"}`}
                />
              )}
            </li>
          );
        })}
      </ol>

      {errorMessage && <p className="mt-4 text-small text-failed">{errorMessage}</p>}
    </div>
  );
}

interface NodeProps {
  position: number;
  reached: number;
  status: DeploymentStatus;
  stopped: boolean;
}

function Node({ position, reached, status, stopped }: NodeProps) {
  if (stopped) {
    return <span className={`text-small leading-none ${STOPPED[status]}`}>✕</span>;
  }

  if (position < reached || status === "READY") {
    return <span className="size-2.5 rounded-full bg-ready" />;
  }

  if (position === reached) {
    return <span className="size-2.5 animate-pulse-dot rounded-full bg-building" />;
  }

  return <span className="size-2.5 rounded-full border border-line" />;
}
