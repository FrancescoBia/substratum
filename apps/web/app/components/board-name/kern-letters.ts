/**
 * Restores kerning to text that has been split into one element per letter (as
 * the board name is, so each letter can animate on its own). Browser-only: it
 * reads layout, so call it from a layout effect.
 */

/**
 * Splitting a name into one `inline-block` per letter drops kerning: the font
 * only kerns within a run of text, so in Geist a name can open up by a pixel or
 * more ("AVATAR Wave To" by ~8.5px). This puts every letter back where the whole
 * text has it, read from `whole` (a copy of the text laid out in the same font
 * and weight, e.g. a screen-reader copy), with a static `margin-left` per
 * letter. Nothing here animates.
 *
 * Positions are differences within each layout, so a running `translate` on the
 * name cancels out, and each letter's own translate is taken off its position.
 * (Not `offsetLeft`: it rounds to whole pixels, which is the size of the error.)
 * Each margin is the change in total correction, snapped to the 1/64px layout
 * grid, so rounding never adds up along a long name.
 */
export const kernLetters = (whole: HTMLElement, els: HTMLElement[]) => {
  const text = whole.firstChild;
  if (!text || els.length < 2) return;
  for (const el of els) el.style.marginLeft = "";
  const range = document.createRange();
  let index = 0;
  const kerned = els.map((el) => {
    const length = el.textContent?.length ?? 0;
    range.setStart(text, index);
    range.setEnd(text, (index += length));
    return range.getBoundingClientRect().left;
  });
  const ownTranslate = (el: Element) => parseFloat(getComputedStyle(el).translate) || 0;
  const split = els.map((el) => el.getBoundingClientRect().left - ownTranslate(el));
  const snap = (px: number) => Math.round(px * 64) / 64;
  let applied = 0;
  els.forEach((el, i) => {
    if (i === 0) return;
    const total = snap(kerned[i] - kerned[0] - (split[i] - split[0]));
    if (total !== applied) el.style.marginLeft = `${total - applied}px`;
    applied = total;
  });
};
