import { describe, expect, it } from "vitest";
import { isDeploymentId, newDeploymentId } from "./id.js";

describe("deployment ids", () => {
  it("generates 10 lowercase alphanumeric characters", () => {
    for (let i = 0; i < 100; i += 1) {
      expect(isDeploymentId(newDeploymentId())).toBe(true);
    }
  });

  it("is collision-free enough to be a subdomain", () => {
    const ids = new Set(Array.from({ length: 1000 }, newDeploymentId));
    expect(ids.size).toBe(1000);
  });

  it("rejects anything that is not a bare 10-character slug", () => {
    expect(isDeploymentId("UPPERCASE1")).toBe(false);
    expect(isDeploymentId("tooshort")).toBe(false);
    expect(isDeploymentId("waytoolongforthis")).toBe(false);
    expect(isDeploymentId("has-dash12")).toBe(false);
    expect(isDeploymentId("abc123defg\n")).toBe(false);
  });
});
