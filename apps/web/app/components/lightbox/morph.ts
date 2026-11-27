import { useCallback, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";
import { LIGHTBOX_PARAM } from "./routing";

/**
 * The `view-transition-name` a grid tile and the viewer's image share so the
 * browser animates one into the other, instead of cross-fading the whole page.
 */
export const MORPH_NAME = "lightbox-image";

/**
 * Which Image is mid-morph, or `null` for none.
 *
 * A view transition name may only be on one element at a time — two elements
 * wearing it makes the browser skip the transition entirely — so the tile and
 * the viewer hand it back and forth rather than both holding it. The hand-off
 * has to be decided *before* the browser captures the "before" frame, which
 * means inside the click handler and not in an effect, and both ends of it are
 * read by siblings with no state in common. A document can only run one view
 * transition at a time, so one module-level value is the whole store.
 */
let morphTarget: string | null = null;
const morphListeners = new Set<() => void>();

function subscribeMorph(listener: () => void) {
  morphListeners.add(listener);
  return () => {
    morphListeners.delete(listener);
  };
}

export function useMorphTarget() {
  return useSyncExternalStore(
    subscribeMorph,
    () => morphTarget,
    // Nothing is morphing on a server render, or on the client's first one.
    () => null,
  );
}

/**
 * Nominates `id` as the next transition's morphing Image. Call it in the same
 * handler that navigates: React flushes this before the router starts the
 * transition, so the tile is already wearing the name when the frame is taken.
 *
 * A reader who asked for less motion gets no nomination and so no morph — the
 * cross-fade the transition falls back to is still fine, an image flying across
 * the page is not.
 */
export function morphFromTile(id: string | null) {
  const next =
    id !== null && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? null : id;
  if (morphTarget === next) return;
  morphTarget = next;
  for (const listener of morphListeners) listener();
}

/**
 * The name each tile's image should carry, if any. The viewer takes the name
 * over for the Image it is showing, so a tile only wears it while its Image is
 * *not* the open one — which is exactly the two frames the morph animates
 * between, and never both at once.
 */
export function useTileMorphName(): (id: string) => string | undefined {
  const morphId = useMorphTarget();
  const [searchParams] = useSearchParams();
  const openId = searchParams.get(LIGHTBOX_PARAM);

  return useCallback(
    (id: string) => (id === morphId && id !== openId ? MORPH_NAME : undefined),
    [morphId, openId],
  );
}

/**
 * Whether the tile for `id` is somewhere the reader can see. After walking the
 * gallery with ← and → the tile you came from can be pages up the page, and an
 * image flying off to somewhere off-screen reads as a glitch rather than as a
 * return — so that case collapses with a plain fade instead.
 */
export function isTileOnScreen(id: string) {
  const tile = document.querySelector(`[data-lightbox-tile="${CSS.escape(id)}"]`);
  if (!tile) return false;

  const rect = tile.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}
