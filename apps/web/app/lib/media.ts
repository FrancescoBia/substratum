/**
 * Small, client-safe helpers for talking about Images that may be stills or
 * videos — kept apart from `library.server.ts` so components can import them.
 */

/** `0:07`, `1:12`, `1:02:03` — the way video players write a length. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * How many of each a view holds: "3 Images", "1 Video", "3 Images, 1 Video".
 * A library with no videos reads exactly as it always did.
 */
export function countLabel(items: Array<{ kind: "image" | "video" }>): string {
  const videos = items.filter((item) => item.kind === "video").length;
  const stills = items.length - videos;

  const parts: string[] = [];
  if (stills > 0 || videos === 0) parts.push(`${stills} Image${stills === 1 ? "" : "s"}`);
  if (videos > 0) parts.push(`${videos} Video${videos === 1 ? "" : "s"}`);
  return parts.join(", ");
}

/** `512 B`, `48 KB`, `1.2 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
