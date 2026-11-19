import { Button } from "@repo/ui/components/button";
import Logo from "@repo/ui/assets/logo/substratum_logo.svg?react";
import { Input } from "@repo/ui/components/input";
import { ScrollArea } from "@repo/ui/components/scroll-area";
import { cn } from "cn";
import {
  AsteriskIcon,
  CheckCircle2Icon,
  Globe,
  Inbox,
  LogOutIcon,
  PlusCircleIcon,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useFetcher, useSubmit } from "react-router";
import { SettingsDialog } from "~/components/settings-dialog";
import { APP_VERSION } from "~/lib/version";

type Board = { id: string; name: string; published: boolean; count: number };
type Tag = { id: string; name: string; count: number };

export const Sidebar = ({
  boards,
  untriagedCount,
}: {
  boards: Board[];
  tags: Tag[];
  untriagedCount: number;
}) => {
  const [creating, setCreating] = useState(false);
  const createBoard = useFetcher();
  const submit = useSubmit();

  return (
    <aside className="bg-sidebar flex w-70 shrink-0 flex-col text-muted-foreground px-1">
      {/* Header */}
      <div className="flex justify-between items-center p-6">
        <Link
          to="/"
          aria-label="Stream"
          title="Stream"
          className="text-foreground hover:text-foreground/70 inline-flex rounded-md transition-colors"
        >
          <Logo className="size-7 shrink-0" />
        </Link>

        {untriagedCount > 0 && (
          <NavLink
            to="/triage"
            aria-label={`Triage (${untriagedCount})`}
            title="Triage"
            className="flex gap-2 items-center text-primary"
          >
            <Inbox className="size-icon" />
            <h4 className="text-xs font-medium tabular-nums">{untriagedCount}</h4>
          </NavLink>
        )}
      </div>

      <Separator />

      <ScrollArea className="grow p-3">
        {boards.length === 0 && !creating && (
          <p className="text-muted-foreground px-2 py-1 text-xs">No boards yet.</p>
        )}

        {boards.map((board) => (
          <BoardItem key={board.id} board={board} />
        ))}
      </ScrollArea>

      <div className="space-y-2 px-3 py-2">
        {creating ? (
          <createBoard.Form
            method="post"
            action="/boards"
            className="flex gap-2"
            onSubmit={() => setCreating(false)}
          >
            <input type="hidden" name="intent" value="create" />
            <Input
              name="name"
              placeholder="Board name…"
              autoFocus
              className="h-8"
              onBlur={(event) => {
                if (
                  event.relatedTarget &&
                  event.currentTarget.form?.contains(event.relatedTarget)
                ) {
                  return;
                }
                if (!event.currentTarget.value.trim()) setCreating(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setCreating(false);
              }}
            />
            <Button type="submit">
              <CheckCircle2Icon className="size-icon" />
            </Button>
          </createBoard.Form>
        ) : (
          <Button onClick={() => setCreating(true)} variant="secondary" className="w-full">
            <PlusCircleIcon className="size-icon" />
            Add Board
          </Button>
        )}

        <div className="flex gap-1 px-2 items-center">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => submit(null, { method: "post", action: "/logout" })}
          >
            <LogOutIcon className="size-icon" />
          </Button>

          <SettingsDialog />

          <span className="grow" />
          <h4 className="text-xs opacity-50 mr-1">v{APP_VERSION}</h4>
        </div>
      </div>
    </aside>
  );
};

const Separator = () => (
  <div className="w-full px-3">
    <div className="border-t w-full" />
  </div>
);

const BoardItem = ({ board }: { board: Board }) => {
  return (
    <NavLink
      to={`/boards/${board.id}`}
      className={({ isActive }) =>
        cn(
          "relative isolate my-px flex w-full items-center gap-2 rounded-md py-1.5 pr-3 pl-3 text-left text-sm text-muted-foreground",
          "transition-[background-color,scale] duration-150 ease-out active:scale-[0.98] motion-reduce:active:scale-100",
          !isActive && "hover:bg-accent/50",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={cn(
              "bg-accent absolute inset-0 -z-10 rounded-md motion-reduce:transition-none",
              isActive
                ? "opacity-100 [clip-path:inset(0_0_0_0_round_6px)] [transition:clip-path_240ms_cubic-bezier(0.23,1,0.32,1)]"
                : "opacity-0 [clip-path:inset(0_100%_0_0_round_6px)] [transition:opacity_150ms_ease-out,clip-path_0ms_150ms]",
            )}
          />
          {/* Enters on the same spring as the name's first letter, so the marker
              reads as what pushes the name along. Leaves on the label's curve. */}
          <AsteriskIcon
            strokeWidth={2.5}
            className={cn(
              "text-primary size-icon absolute left-2 motion-reduce:transition-none",
              isActive ? "translate-x-0 opacity-100" : "-translate-x-3.5 opacity-0",
            )}
            style={{
              transition: isActive
                ? `translate ${PUSH.duration}ms ${PUSH.easing}, opacity 150ms ease-out`
                : "translate 240ms cubic-bezier(0.23, 1, 0.32, 1), opacity 120ms ease-out",
            }}
          />
          <BoardName name={board.name} active={isActive} />
          {board.published && (
            <span className="ml-auto" title="Published">
              <Globe className="size-icon shrink-0" />
            </span>
          )}
          <span className={cn("text-xs tabular-nums", !board.published && "ml-auto")}>
            {board.count}
          </span>
        </>
      )}
    </NavLink>
  );
};

/**
 * The push: a damped spring (ζ 0.75) over `u` = 0…1 of its duration. A click
 * carries no momentum, so it barely overshoots: ~3% at ~190ms, which over the
 * 14px shift is a lean of under half a pixel past the spot before easing home,
 * felt more than seen. One function feeds both the CSS curve (`linear()`,
 * shared with the asterisk) and the per-letter keyframes, so they can't drift.
 *
 * Damping and speed are set apart: ω fixes how fast it gets there (90% in
 * ~113ms), ζ only how much it leans. Raising ζ alone would also slow the rise.
 */
const PUSH_ZETA = 0.75;
const PUSH_OMEGA = 8.46;
const PUSH_OMEGA_D = PUSH_OMEGA * Math.sqrt(1 - PUSH_ZETA ** 2);
const springAt = (u: number) => {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const decay = Math.exp(-PUSH_ZETA * PUSH_OMEGA * u);
  return (
    1 -
    decay *
      (Math.cos(PUSH_OMEGA_D * u) +
        ((PUSH_ZETA * PUSH_OMEGA) / PUSH_OMEGA_D) * Math.sin(PUSH_OMEGA_D * u))
  );
};
const PUSH = {
  duration: 340,
  easing: `linear(${Array.from({ length: 25 }, (_, i) => +springAt(i / 24).toFixed(4)).join(", ")})`,
};
/** How far the name moves to make room for the asterisk: `size-icon`, 14px. */
const SHIFT = 14;

/**
 * Two spreads for one wave. The letters move almost together (≤5ms apart, 50ms
 * end to end): a gap between neighbours closes by at most ~7% as the push
 * passes, a hint of compression rather than a bunch-up. The colour travels
 * wider (≤14ms apart, 140ms end to end), so the left → right wash still reads.
 */
const spread = (step: number, total: number) => (index: number, count: number) =>
  index * Math.min(step, total / Math.max(count - 1, 1));
const moveDelay = spread(5, 50);
const colorDelay = spread(14, 140);

const segmenter = new Intl.Segmenter();

/**
 * Splitting a name into one `inline-block` per letter drops kerning: the font
 * only kerns within a run of text, so in Geist a name can open up by a pixel or
 * more ("AVATAR Wave To" by ~8.5px). This puts every letter back where the whole
 * text has it, read from the screen-reader copy (laid out in the same font and
 * weight, just clipped), with a static `margin-left` per letter. Nothing here
 * animates.
 *
 * Positions are differences within each layout, so a running `translate` on the
 * name cancels out, and each letter's own translate is taken off its position.
 * (Not `offsetLeft`: it rounds to whole pixels, which is the size of the error.)
 * Each margin is the change in total correction, snapped to the 1/64px layout
 * grid, so rounding never adds up along a long name.
 */
const kernLetters = (whole: HTMLElement, els: HTMLElement[]) => {
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

/**
 * A board's name. On select it is pushed in from the left one letter at a time:
 * letter `i` follows the spring `moveDelay(i)` late, and turns to the accent
 * colour on its own delay, so both the push and the colour wash travel
 * left → right. Deselecting is plain: the whole name slides back on the label's
 * curve, in lockstep with the asterisk leaving.
 *
 * The motion is split across two layers so a truncated name holds together.
 * The container (which owns the clip and the "…") moves on the spring timed to
 * the last *visible* letter, and takes its colour then, so the ellipsis travels
 * and changes with the letters beside it. Each letter only adds its offset from
 * that: always ≥ 0, so nothing slides out past the clip's left edge, and the
 * first letter's on-screen path is exactly the spring — the asterisk's path.
 *
 * Letters are split only while selected, and kerned back to match the whole
 * text (see `kernLetters`), so the split doesn't change the spacing.
 */
const BoardName = ({ name, active }: { name: string; active: boolean }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const wholeRef = useRef<HTMLSpanElement>(null);
  const wasActive = useRef(active);
  // Graphemes, not code units, so an emoji or accented letter moves as one.
  const letters = useMemo(() => Array.from(segmenter.segment(name), (s) => s.segment), [name]);

  // Declared before the motion effect so letters are in place before it measures.
  useLayoutEffect(() => {
    if (!active) return;
    const kern = () => {
      if (!ref.current || !wholeRef.current) return;
      kernLetters(wholeRef.current, [
        ...ref.current.querySelectorAll<HTMLElement>("[data-letter]"),
      ]);
    };
    kern();
    // On a page load the web font can arrive after hydration, and margins
    // measured on the fallback font would be pixels off. Measure again then.
    document.fonts.addEventListener("loadingdone", kern);
    return () => document.fonts.removeEventListener("loadingdone", kern);
  }, [active, letters]);

  useLayoutEffect(() => {
    const became = active && !wasActive.current;
    wasActive.current = active;
    // Only on a real selection, never on load: landing on a board isn't a push.
    if (!became || !ref.current) return;

    const label = ref.current;
    const els = [...label.querySelectorAll<HTMLElement>("[data-letter]")];
    if (!els.length) return;

    // The wave spans only what can be seen: letters past the clip share the last
    // visible letter's timing, so a long name doesn't stretch it out.
    const clipRight =
      label.getBoundingClientRect().right - parseFloat(getComputedStyle(label).paddingRight);
    const visible = Math.max(
      1,
      els.filter((el) => el.getBoundingClientRect().left < clipRight).length,
    );
    const slot = (i: number) => Math.min(i, visible - 1);
    const lead = moveDelay(visible - 1, visible); // when the container (and "…") sets off

    const colour = [{ color: "var(--muted-foreground)" }, { color: "var(--primary)" }];
    const tint = { duration: 260, easing: "ease" };
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Colour still washes across under reduced motion; only the movement goes.
    label.animate(colour, { ...tint, delay: colorDelay(visible - 1, visible), fill: "backwards" });
    if (!reduce) {
      label.animate([{ translate: "0px" }, { translate: `${SHIFT}px` }], {
        duration: PUSH.duration,
        delay: lead,
        easing: PUSH.easing,
        fill: "backwards",
      });
    }

    const total = PUSH.duration + lead;
    els.forEach((el, i) => {
      // Held at the end (`both`): the container finishes later and would otherwise
      // pull a finished letter back to its in-between colour. Letters unmount on
      // deselect, so nothing outlives the selection.
      el.animate(colour, { ...tint, delay: colorDelay(slot(i), visible), fill: "both" });
      if (reduce) return;
      // Ahead of the container by however far the spring has got between this
      // letter's start and the container's: a whole letter's lead, sampled.
      const delay = moveDelay(slot(i), visible);
      const frames = Array.from({ length: 33 }, (_, k) => {
        const t = (k / 32) * total;
        const ahead = springAt((t - delay) / PUSH.duration) - springAt((t - lead) / PUSH.duration);
        return { translate: `${(SHIFT * ahead).toFixed(2)}px`, offset: k / 32 };
      });
      el.animate(frames, { duration: total, easing: "linear" });
    });
  }, [active]);

  return (
    <span
      ref={ref}
      className={cn(
        // `pr-3.5` keeps the shifted text clear of the count. `-ml-1 pl-1` gives the
        // clip a hair of room on the left for the spring's sub-pixel settle.
        "-ml-1 truncate pr-3.5 pl-1 motion-reduce:transition-none",
        active
          ? // On select the push is driven by the effect above, so no transition.
            "text-primary translate-x-3.5 font-medium transition-none"
          : "[transition:translate_240ms_cubic-bezier(0.23,1,0.32,1),color_150ms_ease-out]",
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
  );
};
