import { describe, expect, it } from "vitest";
import type { DeploymentStatus } from "../lib/api.js";
import { stepsFor } from "./StatusStepper.js";

const ALL_STATUSES: DeploymentStatus[] = [
  "QUEUED",
  "BUILDING",
  "READY",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
];

/** Past tense beside a running marker is the contradiction this guards against. */
const FINISHED_WORDING = ["Uploaded", "Built", "Live", "Expired"];

describe("stepsFor", () => {
  it.each(ALL_STATUSES)("describes all three stages in %s", (status) => {
    const steps = stepsFor(status);

    expect(steps.map((step) => step.stage)).toEqual(["upload", "build", "live"]);
    expect(steps.every((step) => step.label.length > 0)).toBe(true);
  });

  it.each(ALL_STATUSES)("never labels a running stage as finished in %s", (status) => {
    const running = stepsFor(status).filter((step) => step.state === "active");

    for (const step of running) {
      expect(FINISHED_WORDING).not.toContain(step.label);
    }
  });

  it("says the upload is done and the build is waiting while queued", () => {
    expect(stepsFor("QUEUED")).toEqual([
      { stage: "upload", label: "Uploaded", state: "done" },
      { stage: "build", label: "Queued", state: "active" },
      { stage: "live", label: "Live", state: "pending" },
    ]);
  });

  it("says the build is running while building", () => {
    expect(stepsFor("BUILDING")).toEqual([
      { stage: "upload", label: "Uploaded", state: "done" },
      { stage: "build", label: "Building", state: "active" },
      { stage: "live", label: "Live", state: "pending" },
    ]);
  });

  it("marks every stage finished once live", () => {
    expect(stepsFor("READY")).toEqual([
      { stage: "upload", label: "Uploaded", state: "done" },
      { stage: "build", label: "Built", state: "done" },
      { stage: "live", label: "Live", state: "done" },
    ]);
  });

  it.each(["FAILED", "CANCELLED"] as const)("stops %s at the build, not the upload", (status) => {
    const [upload, build] = stepsFor(status);

    expect(upload).toMatchObject({ label: "Uploaded", state: "done" });
    expect(build?.state).toBe("stopped");
  });

  it("stops an expired deployment at the live stage, since it did build", () => {
    const [, build, live] = stepsFor("EXPIRED");

    expect(build).toMatchObject({ label: "Built", state: "done" });
    expect(live).toMatchObject({ label: "Expired", state: "stopped" });
  });

  it.each(ALL_STATUSES)("marks at most one stage as running in %s", (status) => {
    expect(stepsFor(status).filter((step) => step.state === "active")).toHaveLength(
      status === "QUEUED" || status === "BUILDING" ? 1 : 0,
    );
  });
});
