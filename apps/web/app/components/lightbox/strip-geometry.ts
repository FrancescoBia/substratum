import type { CSSProperties } from "react";
import type { LightboxImage } from "./lightbox";

/**
 * The viewer is a strip of images: the one being viewed in the middle, a sliver
 * of its neighbours at the edges, and more beyond them just out of sight, so a
 * step always has something to slide in. The first and last Images simply have
 * nothing on their outer side.
 *
 * React keys each slot by its index, so stepping keeps every image that is
 * still in the window mounted, and `useStripSpring` slides them along.
 *
 * Four either side, though only one shows: the strip can trail the open Image by
 * up to `MAX_LAG` while it catches up, and whatever it is passing over still has
 * to be there to be seen.
 */
const STRIP_REACH = 4;

export function stripWindow(index: number, total: number): number[] {
  const slots: number[] = [];
  const last = Math.min(index + STRIP_REACH, total - 1);
  for (let slot = Math.max(index - STRIP_REACH, 0); slot <= last; slot++) slots.push(slot);
  return slots;
}

/** The widest any image may be: room left for both neighbours' slivers. */
const MAX_WIDTH = "(100cqw - 2 * (var(--peek) + var(--gap)))";

/**
 * Every image is fitted to the same box — as tall as the stage, and no wider
 * than `MAX_WIDTH` — so its size is known from its dimensions before a byte of
 * it has loaded. All of it is in terms of the stage (`cqw`, `cqh`), `--peek`
 * (how much of a neighbour shows) and `--gap` (the space between two images).
 */
export function slotSize(image: LightboxImage): CSSProperties {
  return {
    width: `min(calc${MAX_WIDTH}, calc(100cqh * ${image.width} / ${image.height}))`,
    aspectRatio: `${image.width} / ${image.height}`,
  };
}

function fittedHeight(image: LightboxImage): string {
  return `min(${MAX_WIDTH} * ${image.height} / ${image.width}, 100cqh)`;
}

/**
 * Where an image's left edge sits `offset` whole slots from the middle. The
 * neighbours hang off the edges of the stage by their inner edge rather than
 * off the open image, so the sliver is the same width whatever shape the
 * image in the middle is. Everything further out sits one widest-possible
 * image beyond the slot before it, out of sight.
 */
export function slotX(offset: number): string {
  if (offset === 0) return "calc(50cqw - 50%)";
  if (offset === -1) return "calc(var(--peek) - 100%)";
  if (offset === 1) return "calc(100cqw - var(--peek))";

  const beyond = `${Math.abs(offset) - 2} * (${MAX_WIDTH} + var(--gap))`;
  return offset < 0
    ? `calc(var(--peek) - var(--gap) - ${MAX_WIDTH} - 100% - ${beyond})`
    : `calc(100cqw - var(--peek) + var(--gap) + ${MAX_WIDTH} + ${beyond})`;
}

export function mix(from: string, to: string, amount: number): string {
  if (amount === 0) return from;
  return `calc(${from} * ${1 - amount} + ${to} * ${amount})`;
}

/** How much of an off-centre image the page shows through. */
const SIDE_DIM = 0.3;

/**
 * Places every slot for the strip being at `at`, which is fractional while it
 * moves: each image is a straight-line blend of the two whole slots it is
 * between.
 *
 * Off-centre images are shown at half size and dimmed, and stand on the open
 * image's bottom edge, shrunk towards their inner bottom corner — so the
 * sliver at the edge stays the same width, and a neighbour stepped to grows
 * up and out of the row into place. The open image is centred, so its bottom
 * edge is a pure function of its dimensions too; between two images it is a
 * blend of both, and the row rides it.
 *
 * Neighbours never collide. Two images a slot apart are blended by the same
 * amount between positions that are at least a gap apart at both ends, and a
 * blend of two such pairs is a gap apart too. Scaling cannot break that: the
 * origin is always inside the box, so a scaled image never leaves the space
 * its full-size box would take.
 */
export function placeStrip(slots: Map<number, HTMLElement>, at: number, images: LightboxImage[]) {
  const below = Math.floor(at);
  const between = at - below;
  const openHeight = mix(
    fittedHeight(images[Math.max(below, 0)]),
    fittedHeight(images[Math.min(below + 1, images.length - 1)]),
    between,
  );

  for (const [slot, element] of slots) {
    const offset = slot - at;
    const whole = Math.floor(offset);
    const x = mix(slotX(whole), slotX(whole + 1), offset - whole);
    // 0 for the open image, 1 for a neighbour and anything further out.
    const aside = Math.min(Math.abs(offset), 1);
    const side = Math.max(-1, Math.min(offset, 1));

    element.style.translate = `${x} calc(50cqh + ${openHeight} / 2 - 100%)`;
    element.style.scale = `${1 - 0.5 * aside}`;
    element.style.transformOrigin = `${50 - 50 * side}% 100%`;
    element.style.setProperty("--dim", `${1 - SIDE_DIM * aside}`);
    element.style.setProperty("--aside", `${aside * 100}%`);
  }
}
