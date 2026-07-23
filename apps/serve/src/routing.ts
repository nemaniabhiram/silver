import { isDeploymentId, siteKey } from "@silver/shared";

/** One server answers for every deployment; the Host header says which. */
export function deploymentIdFromHost(host: string | undefined): string | null {
  if (!host) {
    return null;
  }

  const label = host.split(":")[0]?.split(".")[0]?.toLowerCase() ?? "";
  return isDeploymentId(label) ? label : null;
}

/**
 * The storage key a request path maps to, or null when the path has no business
 * being served. Keys are storage-side, but a path that tries to climb is a
 * signal worth refusing rather than normalising.
 */
export function storageKeyForPath(deploymentId: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  if (decoded.includes("\0") || decoded.split("/").includes("..")) {
    return null;
  }

  const withoutLeadingSlash = decoded.replace(/^\/+/, "");
  const relativePath =
    withoutLeadingSlash === "" || withoutLeadingSlash.endsWith("/")
      ? `${withoutLeadingSlash}index.html`
      : withoutLeadingSlash;

  return siteKey(deploymentId, relativePath);
}

/** A path with no file extension is a client-side route, not a missing asset. */
export function looksLikeClientRoute(requestPath: string): boolean {
  const lastSegment = requestPath.split("/").pop() ?? "";
  return !lastSegment.includes(".");
}
