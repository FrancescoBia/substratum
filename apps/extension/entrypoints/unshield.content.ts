/**
 * Lets a right-click reach an image or video the page has covered with a layer
 * that shows nothing — Instagram lays an empty one over every photo and clip,
 * and many sites stretch a transparent play button over a video, so the
 * browser sees a div or a button and offers no image or video menu, ours
 * included.
 *
 * On a right-button press, those layers stacked over the image or video under
 * the cursor are made click-through just long enough for the browser to
 * hit-test the context menu, then put back. Nothing else is touched: left
 * clicks, hovers and taps never reach this, and a layer with anything to read
 * or see in it (a caption, a labelled button, a like count, a thumbnail) makes
 * it stand aside entirely.
 *
 * Registered at runtime, only for the sites the user switches on — from the
 * options page, or by clicking the toolbar icon on the site, which also injects
 * it into the open tab straight away. See lib/sites.ts.
 */
export default defineContentScript({
  registration: "runtime",
  noScriptStartedPostMessage: true,
  main() {
    // Switching a site off, then on again, injects into the open tab a second
    // time; one listener is enough. The flag lives in the extension's isolated
    // world, which every injection shares and the page can't see.
    const world = globalThis as { substratumUnshield?: true };
    if (world.substratumUnshield) return;
    world.substratumUnshield = true;
    document.addEventListener("mousedown", onMouseDown, true);
  },
});

function onMouseDown(event: MouseEvent) {
  if (event.button !== 2) return;

  const stack = document.elementsFromPoint(event.clientX, event.clientY);
  const media = stack.find(
    (element) =>
      element instanceof HTMLImageElement ||
      element instanceof HTMLVideoElement,
  );
  if (!media) return;

  const covers = stack.slice(0, stack.indexOf(media));
  if (covers.length === 0 || !covers.every(isSeeThrough)) return;

  const saved = (covers as Array<HTMLElement | SVGElement>).map(
    ({ style }) => ({
      style,
      value: style.getPropertyValue("pointer-events"),
      priority: style.getPropertyPriority("pointer-events"),
    }),
  );
  for (const { style } of saved)
    style.setProperty("pointer-events", "none", "important");

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    for (const { style, value, priority } of saved) {
      style.setProperty("pointer-events", value, priority);
    }
  };

  // contextmenu follows mousedown on macOS and mouseup elsewhere; restore on
  // the task after it, so the browser has already hit-tested the media. The
  // timeout covers a press that never becomes a menu (e.g. a drag away).
  document.addEventListener("contextmenu", () => setTimeout(restore), {
    once: true,
    capture: true,
  });
  setTimeout(restore, 1000);
}

/** Anything inside a layer that is content in its own right, not an icon. */
const CONTENT =
  "img, picture, video, canvas, iframe, object, embed, input, select, textarea";

/**
 * A layer with nothing to read in it and nothing to see but, at most, a vector
 * icon — an empty box, or a play button that is only a triangle. The only kind
 * this will ever see through. The icon's own SVG parts are in the stack too,
 * and pass the same test.
 */
function isSeeThrough(element: Element): boolean {
  return (
    (element instanceof HTMLElement || element instanceof SVGElement) &&
    !element.textContent?.trim() &&
    !element.querySelector(CONTENT)
  );
}
