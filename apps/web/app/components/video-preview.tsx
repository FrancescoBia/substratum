import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "~/lib/media";

/**
 * What a video tile adds on top of its poster: a badge saying it is one and how
 * long it runs, and the clip itself while the pointer rests on the tile.
 *
 * Render it inside the tile's link, which must be `relative` and sized by the
 * poster. It listens on that parent rather than asking every grid to thread
 * hover state through its own markup.
 *
 * Nothing is fetched until a hover: the poster is the tile, and a grid of
 * twenty videos costs twenty thumbnails until someone points at one. There is
 * no lightweight preview file yet, so a hover streams the original — which is
 * why it stops, and lets go of the download, the moment the pointer leaves.
 */
export function VideoPreview({
  id,
  durationMs,
  className = "",
}: {
  id: string;
  durationMs: number | null;
  /** Fit classes matching the poster's, so the clip lines up with it exactly. */
  className?: string;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const tile = anchor.current?.parentElement;
    if (!tile) return;

    function enter(event: PointerEvent) {
      // Touch has no hover — a tap opens the viewer, which plays it there. And a
      // reader who asked for less motion gets the poster and the badge.
      if (event.pointerType !== "mouse") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      setHovered(true);
    }
    function leave() {
      setHovered(false);
      setPlaying(false);
    }

    tile.addEventListener("pointerenter", enter);
    tile.addEventListener("pointerleave", leave);
    return () => {
      tile.removeEventListener("pointerenter", enter);
      tile.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <span ref={anchor} className="contents">
      {/* Mounted only while hovered: unmounting is what stops the download. It
          stays invisible until frames are actually coming, so the poster holds
          rather than flashing to an empty box while the first bytes arrive. */}
      {hovered && (
        <video
          src={`/img/${id}/original`}
          muted
          loop
          playsInline
          autoPlay
          aria-hidden
          onPlaying={() => setPlaying(true)}
          className={`pointer-events-none absolute inset-0 size-full rounded-lg object-cover transition-opacity duration-200 ${
            playing ? "opacity-100" : "opacity-0"
          } ${className}`}
        />
      )}
      <DurationBadge durationMs={durationMs} />
    </span>
  );
}

/** Marks a tile as a video, with its length when the file said what it was. */
export function DurationBadge({
  durationMs,
  position = "right-2 bottom-2",
}: {
  durationMs: number | null;
  position?: string;
}) {
  return (
    <span
      className={`pointer-events-none absolute ${position} inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] leading-none font-medium text-white tabular-nums backdrop-blur-sm`}
    >
      <Play className="size-2.5 fill-current" aria-hidden />
      {durationMs !== null && formatDuration(durationMs)}
      <span className="sr-only">Video</span>
    </span>
  );
}
