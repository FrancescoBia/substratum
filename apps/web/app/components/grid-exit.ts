const EXIT_MS = 160;
const EXIT_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * Lets a board's grid fade out after React has already removed it, so the
 * next view's tiles arrive underneath rather than after a cut. Call it while
 * the grid is still in the document (a layout effect's cleanup); it copies the
 * tiles that are on screen into an inert overlay pinned where they were, and
 * fades that away.
 *
 * Nothing happens if the grid is still connected once React's commit is done,
 * which is StrictMode rehearsing an unmount rather than a real one.
 */
export function playGridExit(grid: HTMLElement) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // The grid's parent is the `@container` the mosaic's row tracks resolve
  // against, so the copy takes it along or the tiles would lose their heights.
  const container = grid.parentElement;
  const viewport = grid.closest("main");
  if (!container || !viewport) return;

  const frame = viewport.getBoundingClientRect();
  const box = container.getBoundingClientRect();

  const copy = grid.cloneNode(true) as HTMLElement;
  copy.classList.remove("grid-entrance");
  const copies = [...copy.children];
  [...grid.children].forEach((tile, i) => {
    const rect = tile.getBoundingClientRect();
    if (rect.bottom < frame.top || rect.top > frame.bottom) copies[i].remove();
  });
  copy.querySelectorAll<HTMLElement>("[data-lightbox-tile]").forEach((img) => {
    img.removeAttribute("data-lightbox-tile");
    img.style.viewTransitionName = "";
  });

  const shell = container.cloneNode(false) as HTMLElement;
  shell.append(copy);
  Object.assign(shell.style, {
    position: "absolute",
    left: `${box.left - frame.left}px`,
    top: `${box.top - frame.top}px`,
    width: `${box.width}px`,
    margin: "0",
  });

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
  });
  ghost.append(shell);

  queueMicrotask(() => {
    if (grid.isConnected) return;
    document.body.append(ghost);
    ghost
      .animate([{ opacity: 1 }, { opacity: 0, filter: "blur(2px)" }], {
        duration: EXIT_MS,
        easing: EXIT_EASE,
        fill: "forwards",
      })
      .finished.finally(() => ghost.remove());
  });
}
