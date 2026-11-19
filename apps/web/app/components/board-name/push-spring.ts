/**
 * Timing for the "push" that plays when a board is selected in the sidebar:
 * the spring the name and asterisk move on, how far they move, and how the
 * per-letter delays spread across a name. Pure numbers, no DOM, so the
 * CSS side (`pushVars`) and the WAAPI side (`board-name.tsx`) share one source.
 */
import type { CSSProperties } from "react";

/**
 * The push: a damped spring (ζ 0.75) over `u` = 0…1 of its duration. A click
 * carries no momentum, so it barely overshoots: ~3% at ~190ms, which over the
 * 14px shift is a lean of under half a pixel past the spot before easing home,
 * felt more than seen. One function feeds both the CSS curve (`linear()`,
 * shared with the asterisk) and the per-letter keyframes, so they can't drift.
 *
 * Damping and speed are set apart: ω fixes how fast it gets there (90% in
 * ~113ms), ζ only how much it leans. Raising ζ alone would also slow the rise.
 */
const ZETA = 0.75;
const OMEGA = 8.46;
const OMEGA_D = OMEGA * Math.sqrt(1 - ZETA ** 2);

export const springAt = (u: number) => {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const decay = Math.exp(-ZETA * OMEGA * u);
  return 1 - decay * (Math.cos(OMEGA_D * u) + ((ZETA * OMEGA) / OMEGA_D) * Math.sin(OMEGA_D * u));
};

export const PUSH = {
  duration: 340,
  easing: `linear(${Array.from({ length: 25 }, (_, i) => +springAt(i / 24).toFixed(4)).join(", ")})`,
};

/** How far the name moves to make room for the asterisk: `size-icon`, 14px. */
export const SHIFT = 14;

/**
 * The push as CSS variables, for classes to reach with `var(--push)` (the whole
 * timing, for a `transition`) and `translate-x-(--push-shift)`. Set inline
 * because the curve is computed here; a class can't carry it.
 */
export const pushVars = {
  "--push": `${PUSH.duration}ms ${PUSH.easing}`,
  "--push-shift": `${SHIFT}px`,
} as CSSProperties;

/**
 * Two spreads for one wave. The letters move almost together (≤5ms apart, 50ms
 * end to end): a gap between neighbours closes by at most ~7% as the push
 * passes, a hint of compression rather than a bunch-up. The colour travels
 * wider (≤14ms apart, 140ms end to end), so the left → right wash still reads.
 */
const spread = (step: number, total: number) => (index: number, count: number) =>
  index * Math.min(step, total / Math.max(count - 1, 1));
export const moveDelay = spread(5, 50);
export const colorDelay = spread(14, 140);
