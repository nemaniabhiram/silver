import { describe, expect, it } from "vitest";
import { acceptsBrotli, varyOnEncoding } from "./encoding.js";

describe("acceptsBrotli", () => {
  it("accepts a header that names br", () => {
    expect(acceptsBrotli("br")).toBe(true);
    expect(acceptsBrotli("gzip, deflate, br")).toBe(true);
    expect(acceptsBrotli("gzip, deflate, br, zstd")).toBe(true);
  });

  it("ignores surrounding whitespace and case", () => {
    expect(acceptsBrotli("gzip,  BR ")).toBe(true);
  });

  /** The case a substring check gets backwards: named in order to refuse it. */
  it("treats br;q=0 as a refusal, not a mention", () => {
    expect(acceptsBrotli("br;q=0")).toBe(false);
    expect(acceptsBrotli("gzip, br;q=0")).toBe(false);
    expect(acceptsBrotli("br; q=0")).toBe(false);
  });

  it("accepts a br with any weight above zero", () => {
    expect(acceptsBrotli("br;q=0.1")).toBe(true);
    expect(acceptsBrotli("gzip;q=1.0, br;q=0.5")).toBe(true);
  });

  it("does not read gzip or a wildcard as brotli", () => {
    expect(acceptsBrotli("gzip, deflate")).toBe(false);
    expect(acceptsBrotli("*")).toBe(false);
    expect(acceptsBrotli("brotli")).toBe(false);
  });

  it("is false when the client says nothing", () => {
    expect(acceptsBrotli(undefined)).toBe(false);
    expect(acceptsBrotli("")).toBe(false);
  });
});

describe("varyOnEncoding", () => {
  it("covers the formats worth compressing", () => {
    expect(varyOnEncoding("sites/abc/index.html")).toBe(true);
    expect(varyOnEncoding("sites/abc/assets/app.js")).toBe(true);
    expect(varyOnEncoding("sites/abc/assets/app.css")).toBe(true);
    expect(varyOnEncoding("sites/abc/data.json")).toBe(true);
  });

  it("leaves formats that are already compressed alone", () => {
    expect(varyOnEncoding("sites/abc/photo.png")).toBe(false);
    expect(varyOnEncoding("sites/abc/photo.jpg")).toBe(false);
    expect(varyOnEncoding("sites/abc/font.woff2")).toBe(false);
    expect(varyOnEncoding("sites/abc/clip.mp4")).toBe(false);
  });

  it("reads the extension from the filename, not the path", () => {
    expect(varyOnEncoding("sites/abc/js/logo.png")).toBe(false);
    expect(varyOnEncoding("sites/abc/photos.png/app.js")).toBe(true);
  });
});
