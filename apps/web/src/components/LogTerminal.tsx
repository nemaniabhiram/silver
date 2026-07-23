import { useEffect, useRef, useState } from "react";
import type { LogLine } from "../lib/api.js";
import { CopyButton } from "./CopyButton.js";

const PINNED_THRESHOLD_PX = 24;

export function LogTerminal({ logs }: { logs: LogLine[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const element = scroller.current;
    if (element && pinned) {
      element.scrollTop = element.scrollHeight;
    }
  }, [logs, pinned]);

  return (
    <section className="rounded-card border border-line bg-surface">
      <header className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="text-caption uppercase tracking-[0.05em] text-text-faint">
          Build logs
        </span>
        <CopyButton value={logs.map((line) => line.message).join("\n")} />
      </header>

      <div
        ref={scroller}
        // Following the tail is helpful until the reader scrolls up to read
        // something, at which point yanking them back down is not.
        onScroll={(event) => {
          const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
          setPinned(scrollHeight - scrollTop - clientHeight < PINNED_THRESHOLD_PX);
        }}
        className="max-h-[400px] overflow-y-auto px-4 py-3 font-mono text-[13px] leading-relaxed"
      >
        {logs.map((line) => (
          <p
            key={line.id}
            className={`whitespace-pre-wrap break-words ${
              line.message.startsWith("[silver]") ? "text-text" : "text-text-dim"
            }`}
          >
            {line.message}
          </p>
        ))}
      </div>
    </section>
  );
}
