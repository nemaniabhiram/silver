import { describe, expect, it } from "vitest";
import { hasZipSignature } from "./upload.js";

describe("hasZipSignature", () => {
  it("accepts a zip local file header", () => {
    expect(hasZipSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBe(true);
  });

  it("rejects a text file renamed to .zip", () => {
    expect(hasZipSignature(Buffer.from("hello, world", "utf8"))).toBe(false);
  });

  it("rejects other archive formats", () => {
    expect(hasZipSignature(Buffer.from([0x1f, 0x8b, 0x08, 0x00]))).toBe(false);
    expect(hasZipSignature(Buffer.from([0x52, 0x61, 0x72, 0x21]))).toBe(false);
  });

  it("rejects an empty-archive header, which carries nothing to deploy", () => {
    expect(hasZipSignature(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(false);
  });

  it("rejects a truncated header", () => {
    expect(hasZipSignature(Buffer.from([0x50, 0x4b, 0x03]))).toBe(false);
  });
});
