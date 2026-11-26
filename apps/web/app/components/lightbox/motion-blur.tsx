import type { Ref } from "react";

/**
 * EXPERIMENT: motion blur for a fast-moving strip.
 *
 * A screen shows each frame sharp, so something moving a couple of hundred
 * pixels a frame is seen as a row of crisp copies rather than as movement —
 * strobing, which film never shows because the shutter smears it. This puts
 * the smear back: a horizontal blur scaled to how far the strip moved in the
 * frame, as a shutter open for part of it would have recorded.
 *
 * `MOTION_BLUR` is that fraction — 0 turns the whole thing off. Below half a
 * pixel the filter comes off altogether, so it costs nothing at rest and
 * never softens the open image.
 */
const MOTION_BLUR = 0.25;
const MOTION_BLUR_MAX = 8;
const MOTION_BLUR_FILTER = "lightbox-motion-blur";

/**
 * The filter `blurStrip` turns on. Horizontal only — a CSS `blur()` goes every
 * way and reads as out of focus rather than as speed — and kept inside the
 * stage's own box.
 */
export function MotionBlurFilter({ ref }: { ref: Ref<SVGFEGaussianBlurElement> }) {
  return (
    <svg aria-hidden className="pointer-events-none absolute size-0">
      <filter
        id={MOTION_BLUR_FILTER}
        x="0"
        y="0"
        width="1"
        height="1"
        colorInterpolationFilters="sRGB"
      >
        <feGaussianBlur ref={ref} stdDeviation="0 0" />
      </filter>
    </svg>
  );
}

export function blurStrip(
  stage: HTMLElement,
  blur: SVGFEGaussianBlurElement | null,
  velocity: number,
  frame: number,
) {
  if (!blur) return;

  // A slot is about three quarters of the stage wide: less between narrow
  // images, more between wide ones. Close enough for a smear.
  const travel = Math.abs(velocity) * stage.clientWidth * 0.75 * frame;
  const radius = Math.min(travel * MOTION_BLUR, MOTION_BLUR_MAX);

  if (radius < 0.5) {
    stage.style.filter = "";
    return;
  }
  blur.setAttribute("stdDeviation", `${radius.toFixed(1)} 0`);
  stage.style.filter = `url(#${MOTION_BLUR_FILTER})`;
}
