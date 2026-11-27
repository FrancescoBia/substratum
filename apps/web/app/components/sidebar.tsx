import { Button } from "@repo/ui/components/button";
import Logo from "@repo/ui/assets/logo/substratum_logo.svg?react";
import { ScrollArea } from "@repo/ui/components/scroll-area";
import { cn } from "cn";
import { GlobeIcon, InboxIcon, LogOutIcon } from "lucide-react";
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Await, Link, NavLink, useFetcher, useNavigate, useSubmit } from "react-router";
import { AddBoard } from "~/components/add-board";
import { AppVersion } from "~/components/app-version";
import { BoardName } from "~/components/board-name/board-name";
import { moveFocus } from "~/lib/move-focus";
import { SettingsDialog } from "~/components/settings-dialog";
import type { AvailableUpdate } from "~/lib/update-check.server";

type Board = { id: string; name: string; published: boolean; count: number };
type Tag = { id: string; name: string; count: number };

export const Sidebar = ({
  boards,
  untriagedCount,
  availableUpdate,
}: {
  boards: Board[];
  tags: Tag[];
  untriagedCount: number;
  availableUpdate: Promise<AvailableUpdate | null>;
}) => {
  const [creating, setCreating] = useState(false);
  const createBoard = useFetcher<{ ok: boolean; id?: string }>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const entering = useEnteringIds(boards.map((board) => board.id));

  const asideRef = useRef<HTMLElement>(null);
  const quietArrival = useRef(false);

  // Open the new board once the list has it, so its row arrives unselected and
  // the selection plays on it like any other. Focus follows to its row, unless
  // the person has already moved it somewhere else.
  const opened = useRef<unknown>(null);
  useEffect(() => {
    const data = createBoard.data;
    if (createBoard.state !== "idle" || !data?.ok || !data.id || opened.current === data) return;
    opened.current = data;
    navigate(`/boards/${data.id}`);

    const aside = asideRef.current;
    const row = aside?.querySelector<HTMLElement>(`a[href="/boards/${data.id}"]`);
    const focusInField = aside?.querySelector(".add-board")?.contains(document.activeElement);
    if (row && focusInField) moveFocus(row, { quiet: quietArrival.current });
  }, [createBoard.state, createBoard.data, navigate]);

  return (
    <aside
      ref={asideRef}
      className="bg-sidebar flex w-70 shrink-0 flex-col text-muted-foreground px-1"
    >
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
            <InboxIcon className="size-icon" />
            <h4 className="text-xs font-medium tabular-nums">{untriagedCount}</h4>
          </NavLink>
        )}
      </div>

      <Separator />

      <ScrollArea className="min-h-0 grow p-3">
        {boards.length === 0 && !creating && (
          <p className="text-muted-foreground px-2 py-1 text-xs">No boards yet.</p>
        )}

        {boards.map((board) => (
          <BoardItem key={board.id} board={board} entering={entering.has(board.id)} />
        ))}
      </ScrollArea>

      <div className="space-y-2 px-3 py-2">
        <AddBoard
          onOpenChange={setCreating}
          onCreate={(name, { quiet }) => {
            quietArrival.current = quiet;
            void createBoard.submit(
              { intent: "create", name },
              { method: "post", action: "/boards" },
            );
          }}
        />

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
          <Suspense fallback={<AppVersion />}>
            <Await resolve={availableUpdate} errorElement={<AppVersion />}>
              {(update) => <AppVersion update={update} />}
            </Await>
          </Suspense>
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

/**
 * Ids that weren't in the list on the previous render. The first render counts
 * nothing as new, so the list doesn't animate in on load.
 */
const useEnteringIds = (ids: string[]) => {
  const [known, setKnown] = useState(() => new Set(ids));
  const [entering, setEntering] = useState(() => new Set<string>());
  const added = ids.filter((id) => !known.has(id));
  if (added.length > 0) {
    setKnown(new Set(ids));
    setEntering(new Set([...entering, ...added]));
  }
  return entering;
};

/**
 * A new row opens a gap at its place in the list, pushing the rows below down.
 * One that lands out of view skips that and the list scrolls to it instead:
 * the gap would open where nobody can see it, and the scroll is what shows
 * where the board went.
 */
const BoardItem = ({ board, entering }: { board: Board; entering: boolean }) => {
  const slotRef = useRef<HTMLDivElement>(null);

  // Runs before the new row paints. `entering` never changes once a row is in
  // the list, so this decides once. The attribute is set here rather than
  // rendered so it can come off when the gap is open.
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
