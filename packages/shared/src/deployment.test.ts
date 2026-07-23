import { describe, expect, it } from "vitest";
import { DEPLOYMENT_STATUSES, VALID_TRANSITIONS, canTransition, deploymentUrl } from "./deployment.js";
import { loadConfig } from "./config.js";

describe("transition table", () => {
  it("covers every status", () => {
    expect(Object.keys(VALID_TRANSITIONS).sort()).toEqual([...DEPLOYMENT_STATUSES].sort());
  });

  it("only ever targets known statuses", () => {
    for (const targets of Object.values(VALID_TRANSITIONS)) {
      for (const target of targets) {
        expect(DEPLOYMENT_STATUSES).toContain(target);
      }
    }
  });

  it("allows the happy path", () => {
    expect(canTransition("QUEUED", "BUILDING")).toBe(true);
    expect(canTransition("BUILDING", "READY")).toBe(true);
    expect(canTransition("READY", "EXPIRED")).toBe(true);
  });

  it("rejects resurrection of terminal states", () => {
    expect(canTransition("EXPIRED", "QUEUED")).toBe(false);
    expect(canTransition("READY", "BUILDING")).toBe(false);
    expect(canTransition("QUEUED", "READY")).toBe(false);
  });
});

describe("deploymentUrl", () => {
  it("is derived from config, never stored", () => {
    const config = loadConfig({ DEPLOY_PROTOCOL: "https", DEPLOY_DOMAIN: "silver.sh" });
    expect(deploymentUrl("x7k2m9qw4p", config)).toBe("https://x7k2m9qw4p.silver.sh");
  });
});
