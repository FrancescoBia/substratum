import "~/app.css";
import { beforeAll, describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { BoardName } from "./board-name";

/**
 * A board name made of pairs the font kerns hard (Wa, Ty, Av, at), so a split
 * name that lost its kerning would be visibly off, and the test can tell.
 */
const KERNED = "Wavy Type Avatars";
const LONG = "A board name far too long to fit in the sidebar without fading";

/** A sidebar row as far as `BoardName` cares: `relative`, flex, sidebar width. */
const Row = ({ name, active }: { name: string; active: boolean }) => (
  <div className="relative flex w-70 items-center gap-2 px-3 text-sm">
    <BoardName name={name} active={active} />
  </div>
);

const settle = () => Promise.all(document.getAnimations().map((a) => a.finished));

beforeAll(async () => {
  // Measured against the fallback font, every number here would be wrong.
  await document.fonts.load('400 14px "Geist Variable"');
  await document.fonts.load('500 14px "Geist Variable"');
});

describe("BoardName", () => {
  test("keeps the whole name's spacing once it is split into letters", async () => {
    const screen = await render(<Row name={KERNED} active={false} />);
    await screen.rerender(<Row name={KERNED} active />);
    await settle();

    // Where each letter sits in the unsplit screen-reader copy, against where
    // the split letter actually is, both relative to the first letter.
    const whole = screen.container.querySelector(".sr-only")!.firstChild!;
    const letters = [...screen.container.querySelectorAll<HTMLElement>("[data-letter]")];
    const range = document.createRange();
    let index = 0;
    const kerned = letters.map((el) => {
      range.setStart(whole, index);
      range.setEnd(whole, (index += el.textContent!.length));
      return range.getBoundingClientRect().left;
    });
    const split = letters.map((el) => el.getBoundingClientRect().left);

    for (const [i, el] of letters.entries()) {
      const off = split[i] - split[0] - (kerned[i] - kerned[0]);
      expect(Math.abs(off), `"${el.textContent}" (#${i}) is ${off}px off`).toBeLessThanOrEqual(
        1 / 64,
      );
    }

    // Guard: if this name needed no correction, the loop above proves nothing.
    const corrected = letters.reduce(
      (sum, el) => sum + Math.abs(parseFloat(el.style.marginLeft) || 0),
      0,
    );
    expect(corrected).toBeGreaterThan(1);
  });

  test("slides back from mid-push if the board is deselected halfway through", async () => {
    const screen = await render(<Row name={KERNED} active={false} />);
    const label = screen.container.querySelector<HTMLElement>(".inline-block")!;
    const shift = () => parseFloat(getComputedStyle(label).translate) || 0;

    await screen.rerender(<Row name={KERNED} active />);
    await expect.poll(shift, { interval: 1 }).toBeGreaterThan(5);
    await screen.rerender(<Row name={KERNED} active={false} />);

    // What should be left on the label is the CSS slide back, not the push
    // still playing out over it, and it should start from where the push got to.
    const running = label
      .getAnimations()
      .map((a) => (a instanceof CSSTransition ? a.transitionProperty : "push"))
      .sort();
    expect(running).toEqual(["color", "translate"]);
    expect(shift()).toBeGreaterThan(4);
  });

  test("fades the right edge only when the name runs into it", async () => {
    const short = await render(<Row name={KERNED} active={false} />);
    const shortClip = (short.getByText(KERNED).element() as HTMLElement).parentElement!;
    await expect.poll(() => getComputedStyle(shortClip).maskImage).toBe("none");

    const long = await render(<Row name={LONG} active={false} />);
    const longClip = (long.getByText(LONG).element() as HTMLElement).parentElement!;
    await expect.poll(() => getComputedStyle(longClip).maskImage).toContain("linear-gradient");
  });
});
