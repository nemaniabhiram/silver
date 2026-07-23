import { spawn } from "node:child_process";
import path from "node:path";
import { BuildFailure } from "./failure.js";

export interface SandboxLimits {
  image: string;
  memoryMb: number;
  cpus: number;
  timeoutSeconds: number;
}

export interface SandboxRun {
  deploymentId: string;
  projectDir: string;
  command: string;
  limits: SandboxLimits;
  onOutput: (line: string) => void;
}

/**
 * Runs a build command against untrusted code.
 *
 * The isolation is the container itself: it is thrown away afterwards, runs as
 * a non-root user, and cannot exceed its memory, CPU, process-count or
 * wall-clock budget. The network stays reachable because npm install needs a
 * registry — so the container is given no environment beyond a writable HOME
 * and a cache path, and nothing of the worker's leaks into it.
 */
export async function buildInSandbox(run: SandboxRun): Promise<void> {
  const containerName = `silver-build-${run.deploymentId}`;
  const args = [
    "run",
    "--rm",
    `--name=${containerName}`,
    `--memory=${run.limits.memoryMb}m`,
    `--memory-swap=${run.limits.memoryMb}m`,
    `--cpus=${run.limits.cpus}`,
    "--pids-limit=256",
    "--user=1000:1000",
    "--workdir=/workspace",
    "--volume",
    `${path.resolve(run.projectDir)}:/workspace`,
    "--env",
    "HOME=/tmp",
    "--env",
    "npm_config_cache=/tmp/.npm",
    run.limits.image,
    "sh",
    "-c",
    run.command,
  ];

  const exitCode = await spawnDocker(args, run.onOutput, {
    timeoutMs: run.limits.timeoutSeconds * 1000,
    onTimeout: () => {
      void spawnDocker(["kill", containerName], () => {});
    },
  });

  if (exitCode === "timed-out") {
    throw new BuildFailure(`Build timed out after ${run.limits.timeoutSeconds}s.`);
  }

  if (exitCode !== 0) {
    throw new BuildFailure(`Build failed with exit code ${exitCode}.`);
  }
}

export async function ensureBuilderImage(image: string, onOutput: (line: string) => void): Promise<void> {
  const inspect = await spawnDocker(["image", "inspect", image], () => {});
  if (inspect === 0) {
    return;
  }

  onOutput(`Preparing the build sandbox (${image})…`);
  const context = path.resolve(process.cwd(), "infra", "builder");
  const built = await spawnDocker(["build", "--tag", image, context], onOutput);

  if (built !== 0) {
    throw new Error(`Could not build the sandbox image ${image}.`);
  }
}

interface SpawnOptions {
  timeoutMs?: number;
  onTimeout?: () => void;
}

function spawnDocker(
  args: string[],
  onOutput: (line: string) => void,
  options: SpawnOptions = {},
): Promise<number | "timed-out"> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { windowsHide: true });
    const emit = lineSplitter(onOutput);
    let timedOut = false;

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          options.onTimeout?.();
        }, options.timeoutMs)
      : null;

    child.stdout.on("data", emit);
    child.stderr.on("data", emit);

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      emit.flush();
      resolve(timedOut ? "timed-out" : (code ?? 1));
    });
  });
}

/** Docker writes in chunks, not lines; logs are read a line at a time. */
function lineSplitter(onLine: (line: string) => void) {
  let pending = "";

  const handle = (chunk: Buffer) => {
    pending += chunk.toString("utf8");
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      onLine(line.replace(/\r$/, ""));
    }
  };

  handle.flush = () => {
    if (pending.length > 0) {
      onLine(pending);
      pending = "";
    }
  };

  return handle;
}
