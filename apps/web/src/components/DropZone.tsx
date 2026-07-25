import { useRef, useState } from "react";
import {
  type DroppedFile,
  entriesFrom,
  filesFromEntries,
  filesFromInput,
  loneArchive,
  totalBytes,
  zipFiles,
} from "../lib/zip.js";

const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB ?? 50);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

type Stage = "idle" | "packing" | "uploading";

interface DropZoneProps {
  onDeploy: (archive: Blob, onProgress: (fraction: number) => void) => Promise<void>;
}

export function DropZone({ onDeploy }: DropZoneProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  // dragenter and dragleave both fire when the cursor crosses onto a child, so
  // a single boolean flickers as the user moves across the zone. Counting how
  // deep the drag is means only leaving the zone itself clears the highlight.
  const dragDepth = useRef(0);

  const busy = stage !== "idle";

  function endDrag(): void {
    dragDepth.current = 0;
    setDragging(false);
  }

  async function accept(files: DroppedFile[]): Promise<void> {
    setError(null);

    if (files.length === 0) {
      setError("That drop had no files in it.");
      return;
    }

    if (totalBytes(files) > MAX_UPLOAD_BYTES) {
      setError(`That's over the ${MAX_UPLOAD_MB} MB limit.`);
      return;
    }

    try {
      const archive = loneArchive(files);
      let payload: Blob;

      if (archive) {
        payload = archive;
      } else {
        setProgress(0);
        setStage("packing");
        payload = await zipFiles(files, setProgress);
      }

      if (payload.size > MAX_UPLOAD_BYTES) {
        setError(`That's over the ${MAX_UPLOAD_MB} MB limit.`);
        setStage("idle");
        return;
      }

      setProgress(0);
      setStage("uploading");
      await onDeploy(payload, setProgress);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That upload didn't work.");
      setStage("idle");
    }
  }

  return (
    <div className="w-full">
      <section
        aria-label="Deploy a site"
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          if (!busy) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) endDrag();
        }}
        onDrop={(event) => {
          event.preventDefault();
          endDrag();
          if (busy) return;

          const entries = entriesFrom(event.dataTransfer);
          void filesFromEntries(entries).then(accept);
        }}
        className={`flex flex-col items-center justify-center rounded-card border border-dashed px-6 py-24 text-center transition-[border-color,background-color,transform] duration-150 ${
          dragging
            ? "scale-[1.01] border-solid border-line-active bg-surface"
            : "border-line bg-transparent"
        }`}
      >
        <div className="mb-6 flex size-12 items-center justify-center rounded-full bg-surface-raised">
          {busy ? <Spinner /> : <GlobeGlyph />}
        </div>

        <h1 className="text-display">{headline(stage)}</h1>

        {busy ? (
          <ProgressBar fraction={progress} label={headline(stage)} />
        ) : (
          <p className="mt-4 text-body text-text-dim">
            Drag a folder or a .zip, or{" "}
            <BrowseButton onClick={() => folderInput.current?.click()}>browse folder</BrowseButton>{" "}
            / <BrowseButton onClick={() => zipInput.current?.click()}>browse zip</BrowseButton>
          </p>
        )}

        <p className="mt-6 text-caption uppercase tracking-wider text-text-faint">
          No signup. Static sites only. Live in seconds.
        </p>

        {/* Everything above changes silently for anyone not watching it. The
            percentage stays on the progressbar rather than being announced,
            since a hundred polite interruptions is not progress reporting. */}
        <p role="status" aria-live="polite" className="sr-only">
          {announce(stage)}
        </p>

        <input
          ref={folderInput}
          type="file"
          // @ts-expect-error directory upload is not in the standard typings
          webkitdirectory=""
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void accept(filesFromInput(event.target.files));
            event.target.value = "";
          }}
        />
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(event) => {
            if (event.target.files) void accept(filesFromInput(event.target.files));
            event.target.value = "";
          }}
        />
      </section>

      {error && (
        <p role="alert" className="mt-3 text-small text-failed">
          {error}
        </p>
      )}
    </div>
  );
}

function ProgressBar({ fraction, label }: { fraction: number; label: string }) {
  const percent = Math.round(fraction * 100);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className="mt-6 h-0.5 w-48 overflow-hidden rounded-full bg-line"
    >
      <div
        className="h-full bg-text transition-[width] duration-150"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function BrowseButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm font-semibold text-text underline underline-offset-4 hover:text-text-dim"
    >
      {children}
    </button>
  );
}

function headline(stage: Stage): string {
  if (stage === "packing") return "Packing…";
  if (stage === "uploading") return "Uploading…";
  return "Drop it. It's live.";
}

function announce(stage: Stage): string {
  if (stage === "packing") return "Packing your files";
  if (stage === "uploading") return "Uploading";
  return "";
}

function Spinner() {
  return <span className="size-5 animate-spin rounded-full border-2 border-line border-t-text" />;
}

function GlobeGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="size-5 text-text"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
    </svg>
  );
}
