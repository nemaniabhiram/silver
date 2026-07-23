import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("boots on dev defaults", () => {
    const config = loadConfig({});
    expect(config.API_PORT).toBe(4000);
    expect(config.S3_FORCE_PATH_STYLE).toBe(true);
    expect(config.RETENTION_DAYS).toBe(7);
  });

  it("coerces numeric strings from the environment", () => {
    expect(loadConfig({ MAX_UPLOAD_MB: "200" }).MAX_UPLOAD_MB).toBe(200);
  });

  it("crashes loudly on nonsense", () => {
    expect(() => loadConfig({ API_PORT: "not-a-port" })).toThrow(/API_PORT/);
    expect(() => loadConfig({ S3_FORCE_PATH_STYLE: "yes" })).toThrow(/S3_FORCE_PATH_STYLE/);
    expect(() => loadConfig({ DEPLOY_PROTOCOL: "ftp" })).toThrow(/DEPLOY_PROTOCOL/);
  });
});
