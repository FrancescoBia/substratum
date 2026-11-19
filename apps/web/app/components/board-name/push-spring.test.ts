import { assert, describe, expect, test } from "vitest";
import { colorDelay, moveDelay, PUSH, springAt } from "./push-spring";

describe("springAt", () => {
  test("starts at rest and ends exactly on the spot", () => {
    expect(springAt(-1)).toBe(0);
    expect(springAt(0)).toBe(0);
    expect(springAt(1)).toBe(1);
    expect(springAt(2)).toBe(1);
  });

  test("leans ~3% past the spot around 190ms, as documented", () => {
    const samples = Array.from({ length: 341 }, (_, ms) => springAt(ms / PUSH.duration));
    const peak = Math.max(...samples);
    const at = samples.indexOf(peak);
    assert(peak > 1.02 && peak < 1.04, `peak ${peak}`);
    assert(at > 170 && at < 210, `peak at ${at}ms`);
  });

  test("reaches 90% in ~113ms", () => {
    const ms = Array.from({ length: 341 }, (_, t) => t).find(
      (t) => springAt(t / PUSH.duration) >= 0.9,
    );
    assert(ms !== undefined && ms > 105 && ms < 120, `90% at ${ms}ms`);
  });

  test("hands the CSS curve the same samples", () => {
    expect(PUSH.easing).toMatch(/^linear\(0, .*, 1\)$/);
  });
});

describe("spreads", () => {
  test("step apart until the total would be exceeded, then squeeze", () => {
    expect(moveDelay(3, 5)).toBe(15);
    expect(moveDelay(20, 21)).toBe(50);
    expect(colorDelay(20, 21)).toBe(140);
  });

  test("a single letter has no delay", () => {
    expect(moveDelay(0, 1)).toBe(0);
    expect(colorDelay(0, 1)).toBe(0);
  });
});
