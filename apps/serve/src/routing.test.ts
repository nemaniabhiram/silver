import { describe, expect, it } from "vitest";
import { cacheControlFor } from "./caching.js";
import { deploymentIdFromHost, looksLikeClientRoute, storageKeyForPath } from "./routing.js";

const ID = "x7k2m9qw4p";

describe("deploymentIdFromHost", () => {
  it("reads the id from the leftmost label", () => {
    expect(deploymentIdFromHost(`${ID}.silver.sh`)).toBe(ID);
    expect(deploymentIdFromHost(`${ID}.localhost:4001`)).toBe(ID);
    expect(deploymentIdFromHost(`${ID}.silver.sh:443`)).toBe(ID);
  });

  it("accepts the label in any case", () => {
    expect(deploymentIdFromHost(`${ID.toUpperCase()}.silver.sh`)).toBe(ID);
  });

  it("refuses hosts that carry no deployment id", () => {
    expect(deploymentIdFromHost("silver.sh")).toBeNull();
    expect(deploymentIdFromHost("www.silver.sh")).toBeNull();
    expect(deploymentIdFromHost("localhost:4001")).toBeNull();
    expect(deploymentIdFromHost(undefined)).toBeNull();
    expect(deploymentIdFromHost("short.silver.sh")).toBeNull();
  });
});

describe("storageKeyForPath", () => {
  it("serves index.html for a directory", () => {
    expect(storageKeyForPath(ID, "/")).toBe(`sites/${ID}/index.html`);
    expect(storageKeyForPath(ID, "/docs/")).toBe(`sites/${ID}/docs/index.html`);
  });

  it("maps assets to their key", () => {
    expect(storageKeyForPath(ID, "/assets/app.js")).toBe(`sites/${ID}/assets/app.js`);
  });

  it("decodes escaped characters in filenames", () => {
    expect(storageKeyForPath(ID, "/my%20file.png")).toBe(`sites/${ID}/my file.png`);
  });

  it("refuses traversal, encoded or not", () => {
    expect(storageKeyForPath(ID, "/../secrets")).toBeNull();
    expect(storageKeyForPath(ID, "/assets/../../other/index.html")).toBeNull();
    expect(storageKeyForPath(ID, "/%2e%2e/secrets")).toBeNull();
  });

  it("refuses null bytes and malformed escapes", () => {
    expect(storageKeyForPath(ID, "/index%00.html")).toBeNull();
    expect(storageKeyForPath(ID, "/%zz")).toBeNull();
  });

  it("keeps dots that are part of a name", () => {
    expect(storageKeyForPath(ID, "/..well-known/x")).toBe(`sites/${ID}/..well-known/x`);
  });
});

describe("looksLikeClientRoute", () => {
  it("treats extensionless paths as routes the app should handle", () => {
    expect(looksLikeClientRoute("/dashboard")).toBe(true);
    expect(looksLikeClientRoute("/users/42/edit")).toBe(true);
  });

  it("treats files as files, so a missing asset stays a 404", () => {
    expect(looksLikeClientRoute("/missing.png")).toBe(false);
    expect(looksLikeClientRoute("/assets/app.js")).toBe(false);
  });
});

describe("cacheControlFor", () => {
  const IMMUTABLE = "public, max-age=31536000, immutable";

  it("caches webpack-style hashed assets forever", () => {
    expect(cacheControlFor("/assets/app.4f3a9c21.js")).toBe(IMMUTABLE);
  });

  it("caches vite-style hashed assets forever", () => {
    expect(cacheControlFor("/assets/index-ChUGo7tq.js")).toBe(IMMUTABLE);
    expect(cacheControlFor("/assets/index-DiwrgTda.css")).toBe(IMMUTABLE);
    expect(cacheControlFor("/assets/logo-a1b2c3d4.svg")).toBe(IMMUTABLE);
  });

  it("does not mistake ordinary kebab-case names for digests", () => {
    expect(cacheControlFor("/my-changelog.html")).toBe("no-cache");
    expect(cacheControlFor("/getting-started.html")).toBe("no-cache");
    expect(cacheControlFor("/images/hero-banner.png")).toBe("public, max-age=3600");
  });

  it("always revalidates html", () => {
    expect(cacheControlFor("/index.html")).toBe("no-cache");
  });

  it("gives everything else a modest ttl", () => {
    expect(cacheControlFor("/logo.png")).toBe("public, max-age=3600");
  });

  it("prefers the hashed rule when a name could match both", () => {
    expect(cacheControlFor("/page.a1b2c3d4.html")).toBe("public, max-age=31536000, immutable");
  });

  it("reads the resolved key, since a bare directory has no extension to judge", () => {
    expect(cacheControlFor("/")).toBe("public, max-age=3600");
    expect(cacheControlFor(storageKeyForPath(ID, "/"))).toBe("no-cache");
    expect(cacheControlFor(storageKeyForPath(ID, "/docs/"))).toBe("no-cache");
  });
});
