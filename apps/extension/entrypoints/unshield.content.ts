/**
 * Lets a right-click reach an image the page has covered with an empty overlay
 * — Instagram lays one over every photo, so the browser sees a plain div and
 * offers no image menu, ours included.
 *
 * On a right-button press, any empty elements stacked over the image under the
 * cursor are made click-through just long enough for the browser to hit-test
 * the context menu, then put back. Nothing else is touched: left clicks,
 * hovers and taps never reach this, and an overlay with any content in it
 * (a caption, a button, a like count) makes it stand aside entirely.
 *
 * Registered at runtime, only for the sites the user switches on in the
 * options page — see lib/sites.ts.
 */
export default defineContentScript({
  registration: "runtime",
  noScriptStartedPostMessage: true,
  main() {
    document.addEventListener("mousedown", onMouseDown, true);
  },
});

function onMouseDown(event: MouseEvent) {
  if (event.button !== 2) return;

  const stack = document.elementsFromPoint(event.clientX, event.clientY);
  const image = stack.find((element) => element instanceof HTMLImageElement);
  if (!image) return;

  const covers = stack.slice(0, stack.indexOf(image));
  if (covers.length === 0 || !covers.every(isEmptyBox)) return;

  const saved = covers.map((element) => ({
    style: (element as HTMLElement).style,
    value: (element as HTMLElement).style.getPropertyValue("pointer-events"),
    priority: (element as HTMLElement).style.getPropertyPriority("pointer-events"),
  }));
  for (const { style } of saved) style.setProperty("pointer-events", "none", "important");

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    for (const { style, value, priority } of saved) {
      style.setProperty("pointer-events", value, priority);
    }
  };

  // contextmenu follows mousedown on macOS and mouseup elsewhere; restore on
  // the task after it, so the browser has already hit-tested the image. The
  // timeout covers a press that never becomes a menu (e.g. a drag away).
  document.addEventListener("contextmenu", () => setTimeout(restore), {
    once: true,
    capture: true,
  });
  setTimeout(restore, 1000);
}

/** An overlay with nothing in it — the only kind this will ever see through. */
function isEmptyBox(element: Element): boolean {
  return (
    element instanceof HTMLElement &&
    element.childElementCount === 0 &&
    !element.textContent?.trim()
  );
}
