import { cn } from "cn";
import { AsteriskIcon } from "lucide-react";
import { type RefObject, useLayoutEffect, useMemo, useRef, useState } from "react";
import { kernLetters } from "./kern-letters";
import { colorDelay, moveDelay, PUSH, pushVars, SHIFT, springAt } from "./push-spring";

const segmenter = new Intl.Segmenter();

/**
 * A board's name, and the asterisk that marks it selected. On select the name
 * is pushed in from the left one letter at a time: letter `i` follows the spring
 * `moveDelay(i)` late, and turns to the accent colour on its own delay, so both
 * the push and the colour wash travel left → right. The asterisk enters on the
 * same spring as the first letter, so it reads as what pushes the name along.
 * Deselecting is plain: name and asterisk slide back together on the settle
 * curve (`--board-settle`, see `app.css`).
 *
 * The motion is split across two layers so a clipped name holds together. The
 * label moves on the spring timed to the last *visible* letter and takes its
 * colour at that moment. Each letter only adds its offset from that: always ≥ 0,
 * so nothing slides out past the clip's left edge, and the first letter's
 * on-screen path is exactly the spring — the asterisk's path. The clip around
 * the label stays put, and a long name fades out at its right edge.
 *
 * Letters are split only while selected, and kerned back to match the whole
 * text (see `kernLetters`), so the split doesn't change the spacing.
 *
 * Renders the asterisk absolutely positioned, so the parent row must be
 * `relative`.
 */
export const BoardName = ({ name, active }: { name: string; active: boolean }) => {
  const clipRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const wholeRef = useRef<HTMLSpanElement>(null);
  // Graphemes, not code units, so an emoji or accented letter moves as one.
  const letters = useMemo(() => Array.from(segmenter.segment(name), (s) => s.segment), [name]);

  const fades = useEdgeFade(clipRef, labelRef, SHIFT);
  // Order matters: letters are kerned into place before the push measures them.
  useKernedLetters(wholeRef, labelRef, active, letters);
  usePushIn(labelRef, clipRef, active);

  return (
    <>
      {/* The spring goes in through `--push` rather than an inline `transition`,
          which would beat `motion-reduce:`; under reduced motion only the fade
          is left. */}
      <AsteriskIcon
        strokeWidth={2.5}
        style={pushVars}
        className={cn(
          "text-primary size-icon absolute left-2 motion-reduce:transition-opacity",
          active
            ? "translate-x-0 opacity-100 [transition:translate_var(--push),opacity_150ms_ease-out]"
            : "-translate-x-(--push-shift) opacity-0 [transition:translate_var(--board-settle),opacity_120ms_ease-out]",
        )}
      />
      {/* The clip stays still while the name moves inside it, so the fade at its
          right edge doesn't travel with the push. `-ml-1 pl-1` gives the clip a
          hair of room on the left for the spring's sub-pixel settle. */}
      <span
        ref={clipRef}
        style={pushVars}
        className={cn(
          "-ml-1 min-w-0 flex-1 overflow-hidden pl-1",
          fades && "mask-[linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]",
        )}
      >
        <span
          ref={labelRef}
          className={cn(
            "inline-block align-top whitespace-nowrap motion-reduce:transition-none",
            active
              ? // On select the push is driven by `usePushIn`, so no transition.
                "text-primary translate-x-(--push-shift) font-medium transition-none"
              : "[transition:translate_var(--board-settle),color_150ms_ease-out]",
          )}
        >
          {active ? (
            <>
              <span ref={wholeRef} className="sr-only">
                {name}
              </span>
              <span aria-hidden>
                {letters.map((letter, i) => (
                  <span key={i} data-letter className="inline-block whitespace-pre">
                    {letter}
                  </span>
                ))}
              </span>
            </>
          ) : (
            name
          )}
        </span>
      </span>
    </>
  );
};

/**
 * Whether `label` runs into the right edge of `clip`, counting `extra` px of
 * movement. The name's test counts the push even while unselected, so the fade
 * never switches on halfway through a selection; a name that fits with less
 * than the push to spare gets a faint fade on its last letters, which is fine
 * because it nearly touches the edge. Re-measured on resize, font load and the
 * weight change on select.
 */
const useEdgeFade = (
  clipRef: RefObject<HTMLElement | null>,
  labelRef: RefObject<HTMLElement | null>,
  extra: number,
) => {
  const [fades, setFades] = useState(false);
  useLayoutEffect(() => {
    const clip = clipRef.current;
    const label = labelRef.current;
    if (!clip || !label) return;
    // Sizes come from the observer, not `offsetWidth`/`clientWidth` (whole
    // pixels, so a name on the threshold flickers) or `getBoundingClientRect`
    // (scaled by the row's press, still easing out as the select re-measures).
    // It reports both targets on its first run. The state update from it can
    // land a frame after mount; only a freshly created long name shows that.
    let room = 0; // the clip's content box: its width minus the left padding
    let width = 0;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === clip) room = entry.contentBoxSize[0].inlineSize;
        else width = entry.borderBoxSize[0].inlineSize;
      }
      setFades(width + extra > room);
    });
    observer.observe(clip);
    observer.observe(label);
    return () => observer.disconnect();
  }, [clipRef, labelRef, extra]);
  return fades;
};

/**
 * While `enabled`, kerns the `[data-letter]` spans in `label` to match `whole`
 * (see `kernLetters`), again whenever `letters` change. On a page load the web
 * font can arrive after hydration, and margins measured on the fallback font
 * would be pixels off, so it measures again then.
 */
const useKernedLetters = (
  wholeRef: RefObject<HTMLElement | null>,
  labelRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  letters: string[],
) => {
  useLayoutEffect(() => {
    if (!enabled) return;
    const kern = () => {
      if (!labelRef.current || !wholeRef.current) return;
      kernLetters(wholeRef.current, [
        ...labelRef.current.querySelectorAll<HTMLElement>("[data-letter]"),
      ]);
    };
    kern();
    document.fonts.addEventListener("loadingdone", kern);
    return () => document.fonts.removeEventListener("loadingdone", kern);
  }, [wholeRef, labelRef, enabled, letters]);
};

/**
 * Runs the push when `active` turns true: only on a real selection, never on
 * load, because landing on a board isn't a push. Cancels it if `active` turns
 * false before it finishes.
 */
const usePushIn = (
  labelRef: RefObject<HTMLElement | null>,
  clipRef: RefObject<HTMLElement | null>,
  active: boolean,
) => {
  const wasActive = useRef(active);
  useLayoutEffect(() => {
    const became = active && !wasActive.current;
    wasActive.current = active;
    const label = labelRef.current;
    const clip = clipRef.current;
    if (!became || !label || !clip) return;

    const els = [...label.querySelectorAll<HTMLElement>("[data-letter]")];
    if (!els.length) return;

    // The wave spans only what can be seen: letters past the clip share the last
    // visible letter's timing, so a long name doesn't stretch it out.
    const clipRight = clip.getBoundingClientRect().right;
    const visible = Math.max(
      1,
      els.filter((el) => el.getBoundingClientRect().left < clipRight).length,
    );
    const slot = (i: number) => Math.min(i, visible - 1);
    const lead = moveDelay(visible - 1, visible); // when the label sets off

    const colour = [{ color: "var(--muted-foreground)" }, { color: "var(--primary)" }];
    const tint = { duration: 260, easing: "ease" };
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Kept so a deselect mid-push can stop them (see the cleanup below).
    const running: Animation[] = [];

    // Colour still washes across under reduced motion; only the movement goes.
    running.push(
      label.animate(colour, {
        ...tint,
        delay: colorDelay(visible - 1, visible),
        fill: "backwards",
      }),
    );
    if (!reduce) {
      running.push(
        label.animate([{ translate: "0px" }, { translate: `${SHIFT}px` }], {
          duration: PUSH.duration,
          delay: lead,
          easing: PUSH.easing,
          fill: "backwards",
        }),
      );
    }

    const total = PUSH.duration + lead;
    els.forEach((el, i) => {
      // Held at the end (`both`): the label finishes later and would otherwise
      // pull a finished letter back to its in-between colour. Letters unmount on
      // deselect, so nothing outlives the selection.
      running.push(
        el.animate(colour, { ...tint, delay: colorDelay(slot(i), visible), fill: "both" }),
      );
      if (reduce) return;
      // Ahead of the label by however far the spring has got between this
      // letter's start and the label's: a whole letter's lead, sampled.
      const delay = moveDelay(slot(i), visible);
      const frames = Array.from({ length: 33 }, (_, k) => {
        const t = (k / 32) * total;
        const ahead = springAt((t - delay) / PUSH.duration) - springAt((t - lead) / PUSH.duration);
        return { translate: `${(SHIFT * ahead).toFixed(2)}px`, offset: k / 32 };
      });
      running.push(el.animate(frames, { duration: total, easing: "linear" }));
    });

    // The label outlives the selection. Left running, a quick deselect would
    // see it finish the push in the accent colour, then snap back. Cancelled
    // here, the label's CSS transition picks up from wherever it got to.
    return () => {
      for (const animation of running) animation.cancel();
    };
  }, [labelRef, clipRef, active]);
};
