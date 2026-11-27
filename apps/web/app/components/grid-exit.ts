import { type RefObject, useLayoutEffect } from "react";

const EXIT_MS = 160;
const EXIT_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * Lets a grid fade out after React has already removed it, so the next view's
 * tiles arrive underneath rather than after a cut.
 *
 * It runs in a layout effect's cleanup, which is while the grid is still in the
 * document and the last moment its tiles can be copied. A throw there would
 * take the page down with it, so the exit is skipped instead.
 */
export function useGridExit(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!enabled || !grid) return;
    return () => {
      try {
        playGridExit(grid);
      } catch (error) {
        console.error(error);
      }
    };
  }, [ref, enabled]);
}

/**
 * Copies the tiles of `grid` that are on screen into an inert overlay pinned
 * where they were, and fades that away. Call it while the grid is still in the
 * document.
 *
 * Nothing happens if the grid is still connected once React's commit is done,
 * which is StrictMode rehearsing an unmount rather than a real one.
 */
export function playGridExit(grid: HTMLElement) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const viewport = grid.closest("main");
  if (!viewport) return;
  const frame = viewport.getBoundingClientRect();

  // Only the tiles on screen are copied, so the work done in the middle of a
  // navigation stays the same however big the board is. Each is pinned at the
  // box it was measured at rather than laid out again in a fresh grid, which
  // would pack a scrolled-down subset from the top, and a mosaic differently.
  const tiles: HTMLElement[] = [];
  for (const tile of grid.children) {
    const rect = tile.getBoundingClientRect();
    if (rect.bottom < frame.top || rect.top > frame.bottom) continue;
    const copy = tile.cloneNode(true) as HTMLElement;
    Object.assign(copy.style, {
      position: "absolute",
      left: `${rect.left - frame.left}px`,
      top: `${rect.top - frame.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
      // The mosaic's gutter is a percentage padding, which would resolve
      // against the overlay instead of the tile's grid column.
      padding: getComputedStyle(tile).padding,
    });
    copy.querySelectorAll<HTMLElement>("[data-lightbox-tile]").forEach((img) => {
      img.removeAttribute("data-lightbox-tile");
      img.style.viewTransitionName = "";
    });
    tiles.push(copy);
  }

  const ghost = document.createElement("div");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${frame.left}px`,
    top: `${frame.top}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
    overflow: "hidden",
    pointerEvents: "none",
    // Its own layer, laid out apart from the page: adding it costs the page
    // no relayout, and the fade below runs on the compositor alone, clear of
    // the sidebar's selection, which animates on the main thread at the same
    // moment.
    contain: "strict",
    willChange: "opacity",
  });
  ghost.append(...tiles);

  queueMicrotask(() => {
    if (grid.isConnected) return;
    document.body.append(ghost);
    ghost
      .animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: EXIT_MS,
        easing: EXIT_EASE,
        fill: "forwards",
      })
      .finished.finally(() => ghost.remove());
  });
}
