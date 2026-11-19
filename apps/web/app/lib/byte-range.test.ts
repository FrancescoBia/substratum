import { assert, describe, expect, test } from "vitest";
import { formatRange, parseRange, resolveRange } from "./byte-range";

describe("parseRange", () => {
  test("reads the three single-range forms", () => {
    expect(parseRange("bytes=0-99")).toStrictEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=100-")).toStrictEqual({ start: 100 });
    expect(parseRange("bytes=-500")).toStrictEqual({ suffix: 500 });
  });

  test("ignores what a server may answer with the whole object", () => {
    // Multiple ranges, another unit, a backwards range, and nothing at all.
    expect(parseRange("bytes=0-1,5-6")).toBe(null);
    expect(parseRange("items=0-1")).toBe(null);
    expect(parseRange("bytes=10-5")).toBe(null);
    expect(parseRange("bytes=-")).toBe(null);
    expect(parseRange("bytes=abc")).toBe(null);
  });
});

describe("resolveRange", () => {
  test("clamps an end past the object to its last byte", () => {
    expect(resolveRange({ start: 0, end: 999 }, 100)).toStrictEqual({ start: 0, end: 99 });
    expect(resolveRange({ start: 10 }, 100)).toStrictEqual({ start: 10, end: 99 });
  });

  test("a suffix longer than the object is the whole object", () => {
    expect(resolveRange({ suffix: 500 }, 100)).toStrictEqual({ start: 0, end: 99 });
    expect(resolveRange({ suffix: 10 }, 100)).toStrictEqual({ start: 90, end: 99 });
  });

  test("nothing in range is unsatisfiable", () => {
    expect(resolveRange({ start: 100 }, 100)).toBe(null);
    expect(resolveRange({ suffix: 0 }, 100)).toBe(null);
    expect(resolveRange({ suffix: 10 }, 0)).toBe(null);
  });
});

test("formatRange writes back what parseRange reads", () => {
  for (const header of ["bytes=0-99", "bytes=100-", "bytes=-500"]) {
    const range = parseRange(header);
    assert(range);
    expect(formatRange(range)).toBe(header);
  }
});
