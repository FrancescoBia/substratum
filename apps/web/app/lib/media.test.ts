import { describe, expect, it } from "vitest";
import { formatBytes } from "./media";

describe("formatBytes", () => {
  it("picks the unit by size", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(48 * 1024)).toBe("48 KB");
    expect(formatBytes(1.2 * 1024 * 1024)).toBe("1.2 MB");
  });
});
