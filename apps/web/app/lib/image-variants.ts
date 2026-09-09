/**
 * The shape of the derivatives `ingest.server.ts` writes, in the one place both
 * sides can read it. The edges are a storage decision, but the components that
 * build a `srcSet` have to know what width the bytes actually came out at — so
 * this module is deliberately client-safe and dependency-free.
 */

/** Long edge of each derivative, in pixels. */
export const THUMB_EDGE = 400;
export const MEDIUM_EDGE = 1200;

/**
 * What `sharp`'s `fit: "inside"` resize leaves a derivative's width at. Small
 * images are never enlarged (`withoutEnlargement`), so anything already inside
 * the edge keeps its own width.
 */
export function variantWidth(width: number, height: number, edge: number): number {
  const longest = Math.max(width, height);
  return longest <= edge ? width : Math.round((width * edge) / longest);
}

/**
 * Candidates for a surface showing one Image at full attention: the `medium`
 * derivative, plus the original for displays with the pixels to use it.
 *
 * Undefined when the original is no larger than `medium` — a single-candidate
 * `srcSet` is just a slower way to write `src`.
 */
export function fullSizeSrcSet(image: {
  id: string;
  width: number;
  height: number;
}): string | undefined {
  const mediumWidth = variantWidth(image.width, image.height, MEDIUM_EDGE);
  if (image.width <= mediumWidth) return undefined;
  return `/img/${image.id}/medium ${mediumWidth}w, /img/${image.id}/original ${image.width}w`;
}
