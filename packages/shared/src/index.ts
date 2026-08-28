/**
 * Types shared between the web app's capture endpoint and the extension.
 * Keep this package dependency-free — the extension bundles it directly.
 */

/** What the extension sends for each Capture. It never sends image bytes. */
export type CaptureRequest = {
  sourceImageUrl: string;
  sourcePageUrl: string;
  sourcePageTitle: string;
};

/**
 * Why a Capture failed. The extension maps these to notification copy, so the
 * user learns something actionable rather than "something went wrong".
 */
export type CaptureErrorCode =
  | "unauthenticated"
  | "invalid-request"
  | "fetch-failed"
  | "unsupported-format"
  | "too-large"
  | "server-error";

export type CaptureResponse =
  | { ok: true; imageId: string }
  | { ok: false; code: CaptureErrorCode; message: string };

export const CAPTURE_ENDPOINT = "/api/capture";

/** Largest image we will store. */
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

/** Raster formats only — SVG is deliberately out of scope for v1. */
export const ACCEPTED_FORMATS = ["jpeg", "png", "gif", "webp", "avif"] as const;
export type AcceptedFormat = (typeof ACCEPTED_FORMATS)[number];
