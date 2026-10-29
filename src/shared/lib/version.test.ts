import { describe, expect, it } from "vitest";
import { compareVersions, isNewerVersion, parseVersion } from "./version";

// These cases mirror the Rust tests in
// `src-tauri/src/app/commands/update_cmd.rs`; keep them in sync.

describe("parseVersion", () => {
  it("reads the numeric triple", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
  });

  it("ignores a leading v and any suffix", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("1.2.3-beta.1")).toEqual([1, 2, 3]);
    expect(parseVersion("1.2.3+build.7")).toEqual([1, 2, 3]);
  });

  it("fills the missing parts with zero", () => {
    expect(parseVersion("1.2")).toEqual([1, 2, 0]);
    expect(parseVersion("1")).toEqual([1, 0, 0]);
  });

  it("rejects nonsense", () => {
    expect(parseVersion("nightly")).toBeNull();
    expect(parseVersion("1.0.0.0")).toBeNull();
    expect(parseVersion("1.")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("isNewerVersion", () => {
  it("accepts a higher patch, minor or major", () => {
    expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
    expect(isNewerVersion("1.1.0", "1.0.9")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.99.99")).toBe(true);
  });

  it("rejects the same or an older version", () => {
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("v1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("0.9.9", "1.0.0")).toBe(false);
  });

  it("ignores a leading v on either side", () => {
    expect(isNewerVersion("v1.2.0", "1.1.9")).toBe(true);
    expect(isNewerVersion("V1.2.0", "v1.1.9")).toBe(true);
  });

  it("counts missing parts as zero", () => {
    expect(isNewerVersion("1.2", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.2.1", "1.2")).toBe(true);
  });

  it("does not let a prerelease suffix hide an older core", () => {
    expect(isNewerVersion("1.0.1-beta.1", "1.0.0")).toBe(true);
    expect(isNewerVersion("1.0.0-beta.1", "1.0.0")).toBe(false);
  });

  it("never treats nonsense as an update", () => {
    expect(isNewerVersion("nightly", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "nightly")).toBe(false);
    expect(isNewerVersion("", "1.0.0")).toBe(false);
  });
});

describe("compareVersions", () => {
  it("orders versions", () => {
    expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "v1.0.0")).toBe(0);
  });

  it("treats unparseable input as equal", () => {
    expect(compareVersions("nightly", "1.0.0")).toBe(0);
  });
});
