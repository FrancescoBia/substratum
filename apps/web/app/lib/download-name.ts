/**
 * What a served Image is called once it leaves the browser — by "Save Image
 * As…" or by being dragged onto the desktop. Both take the name from the
 * response's `Content-Disposition` before falling back to the URL, and the URL
 * here ends in `/original`, which is how every file used to come out named
 * `original.jpg`.
 *
 * Kept free of `@repo/shared` so the unit tests can load it under plain Node.
 */

/** The file extension each stored format is given. */
export const FORMAT_EXTENSIONS: Record<string, string> = {
  jpeg: "jpg",
  png: "png",
  gif: "gif",
  webp: "webp",
  avif: "avif",
  mp4: "mp4",
  mov: "mov",
  webm: "webm",
};

/** Extensions a name may already carry, by the format each one means. */
const EXTENSION_FORMATS: Record<string, string> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  jpe: "jpeg",
  jfif: "jpeg",
  png: "png",
  gif: "gif",
  webp: "webp",
  avif: "avif",
  mp4: "mp4",
  m4v: "mp4",
  mov: "mov",
  qt: "mov",
  webm: "webm",
};

/** Long enough for any real name, short of every file system's 255-byte limit. */
const MAX_STEM_LENGTH = 180;

export type NamedImage = {
  id: string;
  /** What the file was called on the Owner's disk, for an upload. */
  filename: string | null;
  sourceImageUrl: string | null;
  title: string | null;
  sourcePageTitle: string | null;
};

/**
 * The name a served file goes out under, ending in the extension of what is
 * actually being served — `format` is the original's, or `webp` for a
 * derivative.
 *
 * In order: the uploaded file's own name, then the last segment of the URL a
 * capture was fetched from, then the Image's title, then its id. A name that
 * already ends in an extension for the same format keeps it as written, so
 * `IMG_0042.JPG` stays exactly that; any other media extension is swapped for
 * the right one rather than doubled up.
 */
export function downloadFilename(image: NamedImage, format: string): string {
  const extension = FORMAT_EXTENSIONS[format] ?? format;
  const candidates = [
    image.filename,
    nameFromUrl(image.sourceImageUrl),
    image.title,
    image.sourcePageTitle,
  ];

  for (const candidate of candidates) {
    const name = sanitize(candidate ?? "");
    if (!name) continue;

    const dot = name.lastIndexOf(".");
    const existing = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
    const existingFormat = EXTENSION_FORMATS[existing];
    if (existingFormat === format) return name;

    const stem = existingFormat ? name.slice(0, dot) : name;
    const trimmed = sanitize(stem.slice(0, MAX_STEM_LENGTH));
    if (trimmed) return `${trimmed}.${extension}`;
  }

  return `${image.id}.${extension}`;
}

/**
 * A `Content-Disposition` that names the file without asking for a download:
 * `inline` keeps it displaying and playing in place. The plain `filename` is an
 * ASCII stand-in for clients that predate `filename*`, which carries the real
 * name in UTF-8.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** The last path segment of an http(s) URL, decoded, or null if there isn't one. */
function nameFromUrl(url: string | null): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const segment = parsed.pathname.split("/").pop() ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Strips what no file system will take — path separators, the characters
 * Windows reserves, control characters — and the leading and trailing dots and
 * spaces macOS and Windows treat specially.
 */
function sanitize(name: string): string {
  return (
    name
      // oxlint-disable-next-line no-control-regex -- ASCII controls and DEL are not legal in a file name
      .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s.]+|[\s.]+$/g, "")
  );
}
