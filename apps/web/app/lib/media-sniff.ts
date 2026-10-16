import type { AcceptedVideoFormat } from "@repo/shared";

/**
 * What an upload is, judged from its first bytes — which path it takes through
 * ingest, never whether it is accepted. That is decided afterwards, by `sharp`
 * for an image and by `ffprobe` for a video, from the whole file.
 *
 * The extension and the declared content type are never consulted: both are
 * whatever the client said.
 */
export type SniffedMedia =
  | { kind: "image" }
  | { kind: "video"; container: AcceptedVideoFormat }
  /** Recognisably a video, in a container that isn't accepted. */
  | { kind: "unsupported-video"; container: string };

/** How many leading bytes `sniffMedia` wants to see. */
export const SNIFF_BYTES = 64;

/**
 * ISO-BMFF brands that mark a still image. AVIF and HEIF share the container
 * MP4 is built on, so `ftyp` alone doesn't say "video".
 */
const IMAGE_BRANDS = new Set(["avif", "avis", "heic", "heix", "hevc", "hevx", "mif1", "msf1"]);

/**
 * Atoms an old QuickTime file may open with when it predates the `ftyp` box.
 */
const LEGACY_QUICKTIME_ATOMS = new Set(["moov", "mdat", "wide", "free", "skip", "pnot"]);

const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

export function sniffMedia(head: Buffer): SniffedMedia {
  const box = head.toString("latin1", 4, 8);

  if (box === "ftyp") {
    const brand = head.toString("latin1", 8, 12);
    if (IMAGE_BRANDS.has(brand)) return { kind: "image" };
    return { kind: "video", container: brand === "qt  " ? "mov" : "mp4" };
  }
  if (LEGACY_QUICKTIME_ATOMS.has(box)) return { kind: "video", container: "mov" };

  // WebM is a restricted Matroska, told apart only by the DocType in the EBML
  // header — which sits within the first few dozen bytes.
  if (head.subarray(0, 4).equals(EBML_MAGIC)) {
    return head.includes("webm", 0, "latin1")
      ? { kind: "video", container: "webm" }
      : { kind: "unsupported-video", container: "MKV" };
  }

  if (head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "AVI ") {
    return { kind: "unsupported-video", container: "AVI" };
  }

  // Everything else goes to `sharp`, which knows images far better than a
  // magic-number table here would.
  return { kind: "image" };
}
