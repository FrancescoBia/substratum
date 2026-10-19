/**
 * HTTP byte ranges — the part of RFC 9110 a browser needs to play and seek a
 * video, and no more.
 *
 * Dependency-free so the unit tests can load it under plain Node, the same way
 * they load the S3 client.
 */

/**
 * One requested range, before anyone knows how large the object is: either an
 * offset with an optional end (`bytes=100-`, `bytes=100-199`) or a count from
 * the end (`bytes=-500`). Offsets are inclusive, as on the wire.
 */
export type ByteRange = { start: number; end?: number } | { suffix: number };

/** A range pinned against an actual size: inclusive offsets, both in bounds. */
export type ResolvedRange = { start: number; end: number };

/**
 * Reads a `Range` header, or returns null when it should be ignored.
 *
 * Null covers every case the spec allows a server to answer with the whole
 * object instead: a unit other than bytes, a malformed value, and more than one
 * range. Browsers ask for exactly one when playing media, and the alternative —
 * `multipart/byteranges` — is a lot of machinery for a request nothing here
 * makes.
 */
export function parseRange(header: string): ByteRange | null {
  const match = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, first, last] = match;

  if (first === "") {
    if (last === "") return null;
    return { suffix: Number(last) };
  }

  const start = Number(first);
  if (last === "") return { start };

  const end = Number(last);
  // A backwards range is invalid syntax rather than unsatisfiable, so it too is
  // ignored rather than refused.
  return end < start ? null : { start, end };
}

/**
 * Pins a range against the object's real size, or returns null when no part of
 * the object is in it — the case that gets a 416.
 */
export function resolveRange(range: ByteRange, size: number): ResolvedRange | null {
  if ("suffix" in range) {
    if (range.suffix === 0 || size === 0) return null;
    return { start: Math.max(0, size - range.suffix), end: size - 1 };
  }

  if (range.start >= size) return null;
  return { start: range.start, end: Math.min(range.end ?? size - 1, size - 1) };
}

/** The `Range` header value that asks for exactly this range. */
export function formatRange(range: ByteRange): string {
  return "suffix" in range ? `bytes=-${range.suffix}` : `bytes=${range.start}-${range.end ?? ""}`;
}
