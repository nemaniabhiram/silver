import { useEffect } from "react";

const DEFAULT_TITLE = "silver · drop it, it's live";

/** Several deployments open at once are only distinguishable by their tabs. */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ?? DEFAULT_TITLE;

    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
