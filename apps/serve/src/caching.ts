interface CacheRule {
  readonly applies: RegExp;
  readonly cacheControl: string;
}

/**
 * Ordered, first match wins. A content-hashed filename can be cached forever
 * because changing the file changes its name; HTML must be revalidated because
 * it is the document that points at those names.
 */
const CACHE_RULES: readonly CacheRule[] = [
  { applies: /\.[0-9a-f]{8,}\./, cacheControl: "public, max-age=31536000, immutable" },
  { applies: /\.html$/, cacheControl: "no-cache" },
];

const DEFAULT_CACHE_CONTROL = "public, max-age=3600";

export function cacheControlFor(pathname: string): string {
  return CACHE_RULES.find((rule) => rule.applies.test(pathname))?.cacheControl ??
    DEFAULT_CACHE_CONTROL;
}
