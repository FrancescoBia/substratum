import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { colorDelay, moveDelay, PUSH, springAt } from "../app/components/board-name/push-spring.ts";

describe("springAt", () => {
  test("starts at rest and ends exactly on the spot", () => {
    assert.equal(springAt(-1), 0);
    assert.equal(springAt(0), 0);
    assert.equal(springAt(1), 1);
    assert.equal(springAt(2), 1);
  });

  test("leans ~3% past the spot around 190ms, as documented", () => {
    const samples = Array.from({ length: 341 }, (_, ms) => springAt(ms / PUSH.duration));
    const peak = Math.max(...samples);
    const at = samples.indexOf(peak);
    assert.ok(peak > 1.02 && peak < 1.04, `peak ${peak}`);
    assert.ok(at > 170 && at < 210, `peak at ${at}ms`);
  });

  test("reaches 90% in ~113ms", () => {
    const ms = Array.from({ length: 341 }, (_, t) => t).find(
      (t) => springAt(t / PUSH.duration) >= 0.9,
    );
    assert.ok(ms !== undefined && ms > 105 && ms < 120, `90% at ${ms}ms`);
  });

  test("hands the CSS curve the same samples", () => {
    assert.match(PUSH.easing, /^linear\(0, .*, 1\)$/);
  });
});

describe("spreads", () => {
  test("step apart until the total would be exceeded, then squeeze", () => {
    assert.equal(moveDelay(3, 5), 15);
    assert.equal(moveDelay(20, 21), 50);
    assert.equal(colorDelay(20, 21), 140);
  });

  test("a single letter has no delay", () => {
    assert.equal(moveDelay(0, 1), 0);
    assert.equal(colorDelay(0, 1), 0);
  });
});
