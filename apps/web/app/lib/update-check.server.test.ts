import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./update-check.server";

describe("isNewerVersion", () => {
  it("orders each part numerically", () => {
    expect(isNewerVersion("0.6.0", "0.5.0")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
    expect(isNewerVersion("0.5.1", "0.5.0")).toBe(true);
  });

  it("is false for the same or an older version", () => {
    expect(isNewerVersion("0.5.0", "0.5.0")).toBe(false);
    expect(isNewerVersion("0.4.9", "0.5.0")).toBe(false);
  });

  it("never offers a pre-release or a malformed tag", () => {
    expect(isNewerVersion("0.6.0-beta.1", "0.5.0")).toBe(false);
    expect(isNewerVersion("latest", "0.5.0")).toBe(false);
  });

  it("offers the final release to someone running its pre-release", () => {
    expect(isNewerVersion("0.6.0", "0.6.0-beta.1")).toBe(true);
    expect(isNewerVersion("0.6.1", "0.6.0-beta.1")).toBe(true);
  });
});
