import { Button } from "@repo/ui/components/button";
import Logo from "@repo/ui/assets/logo/substratum_logo.svg?react";
import { ScrollArea } from "@repo/ui/components/scroll-area";
import { InboxIcon, LogOutIcon } from "lucide-react";
import { Suspense, useRef, useState } from "react";
import { Await, Link, NavLink, useSubmit } from "react-router";
import { AddBoard } from "~/components/add-board/add-board";
import { AppVersion } from "~/components/app-version";
import { SettingsDialog } from "~/components/settings-dialog";
import type { AvailableUpdate } from "~/lib/update-check.server";
import { type Board, BoardItem } from "./board-item";
import { useCreateBoard } from "./use-create-board";
import { useEnteringIds } from "./use-entering-ids";

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
  const submit = useSubmit();
  const asideRef = useRef<HTMLElement>(null);
  const createBoard = useCreateBoard(asideRef);
  const entering = useEnteringIds(boards.map((board) => board.id));

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
        <AddBoard onOpenChange={setCreating} onCreate={createBoard} />

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
