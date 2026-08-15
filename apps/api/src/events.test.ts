import { describe, expect, it, vi } from "vitest";
import { DeploymentEvents } from "./events.js";

const ONE = "k3n8vq2wpd";
const TWO = "b7x4mz9qrt";

describe("DeploymentEvents", () => {
  it("wakes only the people watching the deployment that changed", () => {
    const events = new DeploymentEvents();
    const watchingOne = vi.fn();
    const watchingTwo = vi.fn();

    events.subscribe(ONE, "1.1.1.1", watchingOne);
    events.subscribe(TWO, "1.1.1.1", watchingTwo);
    events.notify(ONE);

    expect(watchingOne).toHaveBeenCalledTimes(1);
    expect(watchingTwo).not.toHaveBeenCalled();
  });

  it("wakes every watcher of the same deployment", () => {
    const events = new DeploymentEvents();
    const first = vi.fn();
    const second = vi.fn();

    events.subscribe(ONE, "1.1.1.1", first);
    events.subscribe(ONE, "2.2.2.2", second);
    events.notify(ONE);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops waking a watcher that has gone", () => {
    const events = new DeploymentEvents();
    const wake = vi.fn();

    const unsubscribe = events.subscribe(ONE, "1.1.1.1", wake);
    unsubscribe();
    events.notify(ONE);

    expect(wake).not.toHaveBeenCalled();
  });

  it("leaves the other watchers alone when one goes", () => {
    const events = new DeploymentEvents();
    const staying = vi.fn();

    const unsubscribe = events.subscribe(ONE, "1.1.1.1", vi.fn());
    events.subscribe(ONE, "1.1.1.1", staying);
    unsubscribe();
    events.notify(ONE);

    expect(staying).toHaveBeenCalledTimes(1);
  });

  it("is quiet about a deployment nobody is watching", () => {
    expect(() => new DeploymentEvents().notify(ONE)).not.toThrow();
  });

  describe("streamsFrom", () => {
    it("counts the open streams held by one address across deployments", () => {
      const events = new DeploymentEvents();

      events.subscribe(ONE, "1.1.1.1", vi.fn());
      events.subscribe(TWO, "1.1.1.1", vi.fn());
      events.subscribe(ONE, "2.2.2.2", vi.fn());

      expect(events.streamsFrom("1.1.1.1")).toBe(2);
      expect(events.streamsFrom("2.2.2.2")).toBe(1);
      expect(events.streamsFrom("3.3.3.3")).toBe(0);
    });

    it("forgets a stream once it closes, so a cap cannot leak", () => {
      const events = new DeploymentEvents();

      const unsubscribe = events.subscribe(ONE, "1.1.1.1", vi.fn());
      expect(events.streamsFrom("1.1.1.1")).toBe(1);

      unsubscribe();
      expect(events.streamsFrom("1.1.1.1")).toBe(0);
    });
  });
});
