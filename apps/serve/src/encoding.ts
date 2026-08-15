/** Kept in step with the worker's list, since one writes what the other reads. */
const COMPRESSIBLE = new Set([
  "html",
  "css",
  "js",
  "mjs",
  "json",
  "svg",
  "txt",
  "xml",
  "map",
  "webmanifest",
  "ico",
]);

/**
 * Whether the client will take Brotli. `br;q=0` is an explicit refusal, which
 * is the case a substring check gets backwards: the header names the encoding
 * precisely in order to reject it.
 */
export function acceptsBrotli(acceptEncoding: string | undefined): boolean {
  if (!acceptEncoding) {
    return false;
  }

  for (const part of acceptEncoding.split(",")) {
    const [name, ...parameters] = part.trim().split(";");
    if (name?.trim().toLowerCase() !== "br") {
      continue;
    }

    const quality = parameters.map((entry) => entry.trim()).find((entry) => entry.startsWith("q="));
    return quality === undefined || Number(quality.slice(2)) > 0;
  }

  return false;
}

/**
 * Whether a compressed twin could exist for this key. Responses for these carry
 * Vary whether or not one was served, because a cache that stored the plain
 * answer without it would hand that answer to a client that wanted Brotli, and
 * the other way round.
 */
export function varyOnEncoding(key: string): boolean {
  const extension = key.split("/").pop()?.split(".").pop()?.toLowerCase() ?? "";
  return COMPRESSIBLE.has(extension);
}
