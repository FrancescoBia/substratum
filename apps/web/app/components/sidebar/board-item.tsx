import { cn } from "cn";
import { GlobeIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { NavLink } from "react-router";
import { BoardName } from "~/components/board-name/board-name";

export type Board = { id: string; name: string; published: boolean; count: number };

export const BoardItem = ({ board, entering }: { board: Board; entering: boolean }) => {
  const slotRef = useArrival(entering);

  return (
    <div
      ref={slotRef}
      className="board-slot"
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget)
          event.currentTarget.removeAttribute("data-opening");
      }}
    >
      <div>
        <NavLink to={`/boards/${board.id}`} className="board-link py-px block group">
          {({ isActive }) => (
            <div
              className={cn(
                "relative isolate flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-muted-foreground",
                "transition-[background-color,scale] duration-150 ease-out active:scale-[0.98] motion-reduce:active:scale-100",
                !isActive && "group-hover:bg-accent/50",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "bg-accent absolute inset-0 -z-10 rounded-md motion-reduce:transition-none",
                  isActive
                    ? "opacity-100 [clip-path:inset(0_0_0_0_round_6px)] [transition:clip-path_var(--board-settle)]"
                    : "opacity-0 [clip-path:inset(0_100%_0_0_round_6px)] [transition:opacity_150ms_ease-out,clip-path_0ms_150ms]",
                )}
              />
              <BoardName name={board.name} active={isActive} />
              {board.published && (
                <span className="shrink-0" title="Published">
                  <GlobeIcon className="size-icon" />
                </span>
              )}
              <span className="shrink-0 text-xs tabular-nums">{board.count}</span>
            </div>
          )}
        </NavLink>
      </div>
    </div>
  );
};

/**
 * A new row opens a gap at its place in the list, pushing the rows below down.
 * One that lands out of view skips that and the list scrolls to it instead:
 * the gap would open where nobody can see it, and the scroll is what shows
 * where the board went.
 *
 * Runs before the row paints. `entering` never changes once a row is in the
 * list, so this decides once. `data-opening` is set here rather than rendered
 * so it can come off when the gap is open.
 */
const useArrival = (entering: boolean) => {
  const slotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!entering || !slot) return;
    const row = slot.querySelector("a")!;
    const bounds = slot.closest("[data-slot=scroll-area-viewport]")?.getBoundingClientRect();
    const top = row.getBoundingClientRect().top;
    const inView = !bounds || (top >= bounds.top && top + row.offsetHeight <= bounds.bottom);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!inView) row.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    else if (!reduce) slot.setAttribute("data-opening", "");
  }, [entering]);

  return slotRef;
};
