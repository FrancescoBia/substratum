import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatRange, parseRange, resolveRange } from "../app/lib/byte-range.ts";

describe("parseRange", () => {
  test("reads the three single-range forms", () => {
    assert.deepEqual(parseRange("bytes=0-99"), { start: 0, end: 99 });
    assert.deepEqual(parseRange("bytes=100-"), { start: 100 });
    assert.deepEqual(parseRange("bytes=-500"), { suffix: 500 });
  });

  test("ignores what a server may answer with the whole object", () => {
    // Multiple ranges, another unit, a backwards range, and nothing at all.
    assert.equal(parseRange("bytes=0-1,5-6"), null);
    assert.equal(parseRange("items=0-1"), null);
    assert.equal(parseRange("bytes=10-5"), null);
    assert.equal(parseRange("bytes=-"), null);
    assert.equal(parseRange("bytes=abc"), null);
  });
});

describe("resolveRange", () => {
  test("clamps an end past the object to its last byte", () => {
    assert.deepEqual(resolveRange({ start: 0, end: 999 }, 100), { start: 0, end: 99 });
    assert.deepEqual(resolveRange({ start: 10 }, 100), { start: 10, end: 99 });
  });

  test("a suffix longer than the object is the whole object", () => {
    assert.deepEqual(resolveRange({ suffix: 500 }, 100), { start: 0, end: 99 });
    assert.deepEqual(resolveRange({ suffix: 10 }, 100), { start: 90, end: 99 });
  });

  test("nothing in range is unsatisfiable", () => {
    assert.equal(resolveRange({ start: 100 }, 100), null);
    assert.equal(resolveRange({ suffix: 0 }, 100), null);
    assert.equal(resolveRange({ suffix: 10 }, 0), null);
  });
});

test("formatRange writes back what parseRange reads", () => {
  for (const header of ["bytes=0-99", "bytes=100-", "bytes=-500"]) {
    const range = parseRange(header);
    assert.ok(range);
    assert.equal(formatRange(range), header);
  }
});
