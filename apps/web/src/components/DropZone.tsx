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
  const [sent, setSent] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  const busy = stage !== "idle";

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
        setStage("packing");
        payload = await zipFiles(files);
      }

      if (payload.size > MAX_UPLOAD_BYTES) {
        setError(`That's over the ${MAX_UPLOAD_MB} MB limit.`);
        setStage("idle");
        return;
      }

      setSent(0);
      setStage("uploading");
      await onDeploy(payload, setSent);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That upload didn't work.");
      setStage("idle");
    }
  }

  return (
    <div className="w-full">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
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
          <div className="mt-6 h-0.5 w-48 overflow-hidden rounded-full bg-line">
            {stage === "uploading" ? (
              <div
                className="h-full bg-text transition-[width] duration-150"
                style={{ width: `${Math.round(sent * 100)}%` }}
              />
            ) : (
              // Packing has no measurable total until it is done.
              <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] bg-text" />
            )}
          </div>
        ) : (
          <p className="mt-4 text-body text-text-dim">
            Drag a folder or a .zip — or{" "}
            <button
              type="button"
              onClick={() => folderInput.current?.click()}
              className="font-semibold text-text underline underline-offset-4"
            >
              browse folder
            </button>{" "}
            /{" "}
            <button
              type="button"
              onClick={() => zipInput.current?.click()}
              className="font-semibold text-text underline underline-offset-4"
            >
              browse zip
            </button>
          </p>
        )}

        <p className="mt-6 text-caption uppercase tracking-wider text-text-faint">
          No signup. Static sites only. Live in seconds.
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
      </div>

      {error && <p className="mt-3 text-small text-failed">{error}</p>}
    </div>
  );
}

function headline(stage: Stage): string {
  if (stage === "packing") return "Packing…";
  if (stage === "uploading") return "Uploading…";
  return "Drop it. It's live.";
}

function Spinner() {
  return (
    <span className="size-5 animate-spin rounded-full border-2 border-line border-t-text" />
  );
}

function GlobeGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-5 text-text">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
    </svg>
  );
}
