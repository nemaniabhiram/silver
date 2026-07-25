import type { DeploymentStatus } from "../lib/api.js";

const STAGES = ["upload", "build", "live"] as const;

type Stage = (typeof STAGES)[number];

/**
 * What each stage is called in a given state. The marker already says whether a
 * stage is finished, running or still to come, so the label has to agree with
 * it. "Uploaded" beside a pulsing dot read as though the upload were still
 * going, when the upload was done and the deployment was waiting for a worker.
 */
const LABELS: Record<DeploymentStatus, Record<Stage, string>> = {
  QUEUED: { upload: "Uploaded", build: "Queued", live: "Live" },
  BUILDING: { upload: "Uploaded", build: "Building", live: "Live" },
  READY: { upload: "Uploaded", build: "Built", live: "Live" },
  FAILED: { upload: "Uploaded", build: "Build failed", live: "Live" },
  CANCELLED: { upload: "Uploaded", build: "Cancelled", live: "Live" },
  EXPIRED: { upload: "Uploaded", build: "Built", live: "Expired" },
};

/**
 * The stage a deployment is at. Everything before it is finished, which is why
 * a cancelled deployment stops at the build: cancelling does not un-upload the
 * files, and the marker used to land on the upload as though it had.
 */
const REACHED: Record<DeploymentStatus, number> = {
  QUEUED: 2,
  BUILDING: 2,
  READY: 3,
  FAILED: 2,
  CANCELLED: 2,
  EXPIRED: 3,
};

const STOPPED: Partial<Record<DeploymentStatus, string>> = {
  FAILED: "text-failed",
  CANCELLED: "text-cancelled",
  EXPIRED: "text-expired",
};

export type StepState = "done" | "active" | "stopped" | "pending";

export interface Step {
  stage: Stage;
  label: string;
  state: StepState;
}

/** The whole stepper as data, so what it says can be read without a browser. */
export function stepsFor(status: DeploymentStatus): Step[] {
  const reached = REACHED[status];
  const labels = LABELS[status];

  return STAGES.map((stage, index) => {
    const position = index + 1;
    const label = labels[stage];

    if (position === reached && status in STOPPED) {
      return { stage, label, state: "stopped" };
    }
    if (position < reached || status === "READY") {
      return { stage, label, state: "done" };
    }
    if (position === reached) {
      return { stage, label, state: "active" };
    }
    return { stage, label, state: "pending" };
  });
}

interface StatusStepperProps {
  status: DeploymentStatus;
  errorMessage: string | null;
}

export function StatusStepper({ status, errorMessage }: StatusStepperProps) {
  const steps = stepsFor(status);

  return (
    <div>
      <ol className="flex items-center">
        {steps.map(({ stage, label, state }, index) => (
          <li key={stage} className="flex flex-1 items-center gap-3 last:flex-none">
            <div
              className="flex items-center gap-2"
              aria-current={state === "active" ? "step" : undefined}
            >
              <Marker state={state} status={status} />
              <span
                className={`text-small ${state === "pending" ? "text-text-faint" : "text-text"}`}
              >
                {label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <span className={`h-px flex-1 ${state === "done" ? "bg-text-dim" : "bg-line"}`} />
            )}
          </li>
        ))}
      </ol>

      {errorMessage && <p className="mt-4 text-small text-failed">{errorMessage}</p>}
    </div>
  );
}

function Marker({ state, status }: { state: StepState; status: DeploymentStatus }) {
  if (state === "stopped") {
    return <span className={`text-small leading-none ${STOPPED[status]}`}>✕</span>;
  }
  if (state === "done") {
    return <span className="size-2.5 rounded-full bg-ready" />;
  }
  if (state === "active") {
    return <span className="size-2.5 animate-pulse-dot rounded-full bg-building" />;
  }
  return <span className="size-2.5 rounded-full border border-line" />;
}
