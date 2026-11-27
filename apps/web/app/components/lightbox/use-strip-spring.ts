import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The strip is moved by a spring rather than a CSS transition, for the two
 * things a fixed curve gets wrong when stepping:
 *
 * - It answers at once. A spring pulls hardest when it is furthest from where
 *   it is going, so the strip is already moving on the frame after the key,
 *   and the resistance is all at the far end, where it settles into place.
 * - It keeps its speed when the target moves. A transition restarted from
 *   wherever it had got to starts again from rest, so quick steps stutter —
 *   lurch, brake, lurch. A spring just has somewhere new to go, so a run of
 *   steps reads as one glide that slows down once the steps stop.
 *
 * Critically damped, so it never overshoots: ω = √180 ≈ 13.4/s puts a step
 * half way there in ~125ms and within 1% of it in ~500ms.
 */
const SPRING_STIFFNESS = 180;
const SPRING_DAMPING = 2 * Math.sqrt(SPRING_STIFFNESS);

/**
 * How far the strip may trail its target, in slots. A spring following steady
 * steps trails them by 2/ω slots per step-per-second — about 1.6 slots for
 * someone tapping eleven times a second — so this leaves room for quick
 * tapping to glide. Arrows held down repeat faster than any spring worth
 * looking at can follow; past this the strip is dragged along rather than
 * left to fall further and further behind.
 */
const MAX_LAG = 2.5;

/**
 * Drives the strip's position towards `target` and calls `paint` with it on
 * every frame. Painting happens outside React — a render per frame for
 * something only styles depend on would be all cost — but also once after
 * every render, so slots that have just mounted are placed before the browser
 * gets to draw them where they are not.
 *
 * `paint` also gets the strip's velocity, in slots per second.
 *
 * Returns the position the strip last came to rest at, or `null` before it
 * first has: the one moment it is worth starting expensive work. Never sooner
 * than a frame after a render, which is what the opening morph needs.
 */
export function useStripSpring(
  target: number,
  paint: (at: number, velocity: number) => void,
): number | null {
  const spring = useRef({
    at: target,
    velocity: 0,
    target,
    frame: 0,
    last: 0,
    restFrame: 0,
  });
  const paintRef = useRef(paint);
  const [settledAt, setSettledAt] = useState<number | null>(null);

  useLayoutEffect(() => {
    const state = spring.current;
    paintRef.current = paint;
    state.target = target;

    // A reader who asked for less motion gets the strip where it is going.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cancelAnimationFrame(state.frame);
      state.frame = 0;
      state.at = target;
      state.velocity = 0;
    }

    state.at = Math.min(Math.max(state.at, target - MAX_LAG), target + MAX_LAG);
    paint(state.at, state.velocity);
    if (state.frame) return;

    if (state.at === target && state.velocity === 0) {
      if (settledAt !== target && !state.restFrame) {
        state.restFrame = requestAnimationFrame(() => {
          state.restFrame = 0;
          setSettledAt(state.target);
        });
      }
      return;
    }
    cancelAnimationFrame(state.restFrame);
    state.restFrame = 0;

    function tick(now: number) {
      // Capped, so a frame that arrives late — a background tab coming back —
      // finishes the motion instead of jumping past it.
      const frame = Math.min((now - state.last) / 1000, 0.1);
      let remaining = frame;
      state.last = now;

      // Small fixed steps keep the integration stable at any frame rate.
      while (remaining > 0) {
        const dt = Math.min(remaining, 1 / 240);
        const force =
          -SPRING_STIFFNESS * (state.at - state.target) - SPRING_DAMPING * state.velocity;
        state.velocity += force * dt;
        state.at += state.velocity * dt;
        remaining -= dt;
      }

      if (Math.abs(state.at - state.target) < 0.0005 && Math.abs(state.velocity) < 0.005) {
        state.at = state.target;
        state.velocity = 0;
        state.frame = 0;
        setSettledAt(state.target);
      } else {
        state.frame = requestAnimationFrame(tick);
      }
      paintRef.current(state.at, state.velocity);
    }

    state.last = performance.now();
    state.frame = requestAnimationFrame(tick);
  });

  // Zeroed as well as cancelled: the handles double as "already scheduled", and
  // a remount — StrictMode does one on purpose — would otherwise wait forever
  // for frames that were cancelled here.
  useEffect(() => {
    const state = spring.current;
    return () => {
      cancelAnimationFrame(state.frame);
      cancelAnimationFrame(state.restFrame);
      state.frame = 0;
      state.restFrame = 0;
    };
  }, []);

  return settledAt;
}
