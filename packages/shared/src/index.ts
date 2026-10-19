/**
 * Types shared between the web app's capture endpoint and the extension.
 * Keep this package dependency-free — the extension bundles it directly.
 */

/**
 * What the extension sends for each Capture, of an image or a video. It never
 * sends the bytes. `sourceImageUrl` keeps its name for videos too: a video is
 * an Image of kind "video".
 */
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

/**
 * Largest video we will store — 95 MB, deliberately short of a rounder 100.
 *
 * Cloudflare's Free and Pro plans refuse any request body over 100 MB before it
 * reaches the origin, and putting a self-hosted instance behind Cloudflare (or a
 * Cloudflare Tunnel) is common. That limit is on the whole request, so the
 * multipart envelope around the file counts against it too; 95 leaves room.
 *
 * nginx has its own, separate limit — `client_max_body_size`, 1 MB unless an
 * operator raises it, which they already have to for images.
 *
 * Raising this means either accepting that Cloudflare-fronted instances will
 * refuse large videos with a bare 413, or splitting uploads into chunks under
 * the proxy limit and reassembling them on the server.
 */
export const MAX_VIDEO_BYTES = 95 * 1024 * 1024;

/** Raster formats only — SVG is deliberately out of scope for v1. */
export const ACCEPTED_FORMATS = ["jpeg", "png", "gif", "webp", "avif"] as const;
export type AcceptedFormat = (typeof ACCEPTED_FORMATS)[number];

/**
 * The containers a video may arrive in. Which codecs are allowed inside them is
 * the ingest's call, made from the bytes.
 */
export const ACCEPTED_VIDEO_FORMATS = ["mp4", "mov", "webm"] as const;
export type AcceptedVideoFormat = (typeof ACCEPTED_VIDEO_FORMATS)[number];

/**
 * How each accepted format is labelled on the wire when an Image is served.
 *
 * MOV goes out as `video/mp4`, not `video/quicktime`. The two containers are
 * close kin and every browser plays H.264 in a MOV under the MP4 label, while
 * Chrome and Firefox decline the QuickTime one outright.
 *
 * The S3 client in apps/web keeps its own copy for labelling stored objects,
 * because it has to load under plain Node where this package cannot; a test
 * there fails if the two drift apart.
 */
export const FORMAT_CONTENT_TYPES: Record<AcceptedFormat | AcceptedVideoFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  mp4: "video/mp4",
  mov: "video/mp4",
  webm: "video/webm",
};

/** The content type for a stored Image's recorded format. */
export function contentTypeForFormat(format: string): string {
  return (
    FORMAT_CONTENT_TYPES[format as AcceptedFormat | AcceptedVideoFormat] ??
    "application/octet-stream"
  );
}
