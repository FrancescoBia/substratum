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
import { useState } from "react";
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
          <AsteriskIcon
            strokeWidth={2.5}
            className={cn(
              "text-primary size-icon absolute left-2 motion-reduce:transition-none",
              isActive
                ? "translate-x-0 opacity-100 [transition:translate_240ms_cubic-bezier(0.23,1,0.32,1),opacity_150ms_ease-out]"
                : "-translate-x-3.5 opacity-0 [transition:translate_240ms_cubic-bezier(0.23,1,0.32,1),opacity_120ms_ease-out]",
            )}
          />
          <span
            className={cn(
              "truncate pr-3.5 transition-[translate,color] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
              isActive && "text-primary translate-x-3.5 font-medium",
            )}
          >
            {board.name}
          </span>
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
