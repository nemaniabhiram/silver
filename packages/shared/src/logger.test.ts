import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";

function captured(): { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => lines.push(String(line)));
  vi.spyOn(console, "error").mockImplementation((line: unknown) => errors.push(String(line)));
  return { lines, errors };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("json format", () => {
  it("emits one parseable line carrying ts, level, service and msg", () => {
    const { lines } = captured();

    createLogger("api", "json").info("listening", { port: 4000 });

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry["level"]).toBe("info");
    expect(entry["service"]).toBe("api");
    expect(entry["msg"]).toBe("listening");
    expect(entry["port"]).toBe(4000);
    expect(typeof entry["ts"]).toBe("string");
    expect(new Date(String(entry["ts"])).toString()).not.toBe("Invalid Date");
  });

  it("keeps the stack of a thrown Error so a failure can be traced", () => {
    const { errors } = captured();

    createLogger("worker", "json").error("build failed", new Error("boom"));

    const entry = JSON.parse(errors[0] ?? "{}") as Record<string, unknown>;
    expect(entry["err"]).toBe("boom");
    expect(String(entry["stack"])).toContain("Error: boom");
  });

  it("describes a thrown non-Error rather than dropping it", () => {
    const { errors } = captured();

    createLogger("worker", "json").error("odd", "just a string");

    expect((JSON.parse(errors[0] ?? "{}") as Record<string, unknown>)["err"]).toBe("just a string");
  });
});

describe("child loggers", () => {
  it("stamps its fields on every line", () => {
    const { lines } = captured();
    const log = createLogger("worker", "json").child({ deploymentId: "k3n8vq2wpd" });

    log.info("building");
    log.info("uploaded");

    for (const line of lines) {
      expect((JSON.parse(line) as Record<string, unknown>)["deploymentId"]).toBe("k3n8vq2wpd");
    }
  });

  it("merges over the parent without changing it", () => {
    const { lines } = captured();
    const parent = createLogger("worker", "json").child({ stage: "claim" });
    const child = parent.child({ stage: "build", attempt: 2 });

    child.info("one");
    parent.info("two");

    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    const second = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
    expect(first["stage"]).toBe("build");
    expect(first["attempt"]).toBe(2);
    expect(second["stage"]).toBe("claim");
    expect(second["attempt"]).toBeUndefined();
  });
});

describe("pretty format", () => {
  it("renders the service, the message and the fields on one line", () => {
    const { lines } = captured();

    createLogger("serve").info("listening", { port: 4001 });

    expect(lines[0]).toBe("[serve] listening port=4001");
  });

  it("omits fields that are undefined rather than printing the word", () => {
    const { lines } = captured();

    createLogger("api").info("done", { kept: "yes", missing: undefined });

    expect(lines[0]).toBe("[api] done kept=yes");
  });

  it("leaves no trailing space when there are no fields", () => {
    const { lines } = captured();

    createLogger("api").info("stopped");

    expect(lines[0]).toBe("[api] stopped");
  });
});
