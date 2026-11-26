import type { ShouldRevalidateFunctionArgs } from "react-router";

/**
 * The search param that holds the Image being viewed full size. Like `?image=`
 * for the detail panel, this keeps the viewer shareable, reload-stable, and
 * closable with the back button — but it is a *separate* param so the two can
 * never fight over the same slot.
 */
export const LIGHTBOX_PARAM = "view";

/**
 * Opening the viewer, and stepping through it, only moves `?view=`. No loader
 * reads that param, so without this every arrow key would re-run the route's
 * queries to render markup that cannot have changed.
 *
 * Deliberately narrow: it bows out for submissions and for any navigation where
 * something other than `?view=` moved, so a revalidation after an edit still
 * goes through.
 */
export function skipLightboxRevalidation({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod) return defaultShouldRevalidate;
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;

  const current = new URLSearchParams(currentUrl.search);
  const next = new URLSearchParams(nextUrl.search);
  if (current.get(LIGHTBOX_PARAM) === next.get(LIGHTBOX_PARAM)) return defaultShouldRevalidate;

  current.delete(LIGHTBOX_PARAM);
  next.delete(LIGHTBOX_PARAM);
  current.sort();
  next.sort();
  return current.toString() === next.toString() ? false : defaultShouldRevalidate;
}
