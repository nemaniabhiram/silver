const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "no-cache";
const SHORT_LIVED = "public, max-age=3600";

/** webpack and CRA: app.4f3a9c21.js */
const DOTTED_HEX_HASH = /\.[0-9a-f]{8,}\./;

/** vite and rollup: index-ChUGo7tq.js */
const DASHED_HASH = /-([A-Za-z0-9_-]{8,})\.[^.]+$/;

/**
 * A content-hashed name can be cached forever, because changing the file
 * changes its name. Guessing wrong in that direction serves a stale file for a
 * year, so the dashed form — which resembles ordinary kebab-case names — must
 * also look random: kebab-case is conventionally lowercase words, while a
 * base64url digest carries uppercase, or digits in a fixed-width run.
 */
export function isContentHashed(pathname: string): boolean {
  const filename = pathname.split("/").pop() ?? "";

  if (DOTTED_HEX_HASH.test(filename)) {
    return true;
  }

  const digest = DASHED_HASH.exec(filename)?.[1];
  if (!digest) {
    return false;
  }

  return /[A-Z]/.test(digest) || (/\d/.test(digest) && digest.length === 8);
}

export function cacheControlFor(pathname: string): string {
  if (isContentHashed(pathname)) {
    return IMMUTABLE;
  }

  return pathname.endsWith(".html") ? REVALIDATE : SHORT_LIVED;
}
