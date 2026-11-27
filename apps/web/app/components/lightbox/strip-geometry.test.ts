import { describe, expect, it } from "vitest";
import { mix, slotX, stripWindow } from "./strip-geometry";

describe("stripWindow", () => {
  it("reaches four slots either side of the open one", () => {
    expect(stripWindow(10, 20)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("has nothing past either end of the set", () => {
    expect(stripWindow(0, 20)).toEqual([0, 1, 2, 3, 4]);
    expect(stripWindow(19, 20)).toEqual([15, 16, 17, 18, 19]);
    expect(stripWindow(0, 1)).toEqual([0]);
  });
});

describe("slotX", () => {
  it("centres the open image and hangs the neighbours off the stage edges", () => {
    expect(slotX(0)).toBe("calc(50cqw - 50%)");
    expect(slotX(-1)).toBe("calc(var(--peek) - 100%)");
    expect(slotX(1)).toBe("calc(100cqw - var(--peek))");
  });

  it("puts further slots a widest image apart, out of sight", () => {
    expect(slotX(2)).toContain("100cqw - var(--peek) + var(--gap)");
    expect(slotX(3)).toContain("1 * (");
    expect(slotX(-3)).toContain("- 1 * (");
  });
});

describe("mix", () => {
  it("is the start itself when there is nothing to blend", () => {
    expect(mix("10px", "20px", 0)).toBe("10px");
  });

  it("blends linearly between the two", () => {
    expect(mix("10px", "20px", 0.25)).toBe("calc(10px * 0.75 + 20px * 0.25)");
  });
});
