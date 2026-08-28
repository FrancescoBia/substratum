import { Download, Globe, Hash, Inbox, Layers, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Form, NavLink, useFetcher } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";

type Board = { id: string; name: string; published: boolean; count: number };
type Tag = { id: string; name: string; count: number };

const item =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors";

function navClass({ isActive }: { isActive: boolean }) {
  return `${item} ${isActive ? "bg-accent font-medium" : "hover:bg-accent/50"}`;
}

/**
 * The persistent shell from the prototype: Stream, Boards, Tags. Always visible,
 * so the shape of the collection is legible without navigating anywhere.
 */
export function Sidebar({
  boards,
  tags,
  untriagedCount,
  trashCount,
  email,
}: {
  boards: Board[];
  tags: Tag[];
  untriagedCount: number;
  trashCount: number;
  email: string;
}) {
  const [creating, setCreating] = useState(false);
  const createBoard = useFetcher();

  return (
    <aside className="bg-sidebar flex w-60 shrink-0 flex-col border-r">
      <div className="px-4 py-5">
        <div className="text-lg font-semibold tracking-tight">Substratum</div>
        <div className="text-muted-foreground truncate text-xs">{email}</div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2">
        <NavLink to="/" end className={navClass}>
          <Layers className="size-4" /> Stream
        </NavLink>

        {untriagedCount > 0 && (
          <NavLink to="/triage" className={navClass}>
            <Inbox className="size-4" /> Triage
            <Badge variant="secondary" className="ml-auto">
              {untriagedCount}
            </Badge>
          </NavLink>
        )}

        <div className="text-muted-foreground mt-5 mb-1 flex items-center justify-between px-2">
          <span className="text-xs font-medium tracking-wide uppercase">Boards</span>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="hover:text-foreground"
            aria-label="New board"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        {creating && (
          <createBoard.Form
            method="post"
            action="/boards"
            className="px-1 py-1"
            onSubmit={() => setCreating(false)}
          >
            <input type="hidden" name="intent" value="create" />
            <Input
              name="name"
              placeholder="Board name…"
              autoFocus
              className="h-8"
              onBlur={(event) => {
                if (!event.currentTarget.value.trim()) setCreating(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setCreating(false);
              }}
            />
          </createBoard.Form>
        )}

        {boards.length === 0 && !creating && (
          <p className="text-muted-foreground px-2 py-1 text-xs">No boards yet.</p>
        )}

        {boards.map((board) => (
          <NavLink key={board.id} to={`/boards/${board.id}`} className={navClass}>
            <span className="truncate">{board.name}</span>
            {board.published && (
              <span className="ml-auto" title="Published">
                <Globe className="text-muted-foreground size-3.5 shrink-0" />
              </span>
            )}
            <span className={`text-muted-foreground text-xs ${board.published ? "" : "ml-auto"}`}>
              {board.count}
            </span>
          </NavLink>
        ))}

        {tags.length > 0 && (
          <>
            <div className="text-muted-foreground mt-5 mb-1 px-2 text-xs font-medium tracking-wide uppercase">
              Tags
            </div>
            {tags.map((tag) => (
              <NavLink key={tag.id} to={`/tag/${encodeURIComponent(tag.name)}`} className={navClass}>
                <Hash className="size-3.5 shrink-0" />
                <span className="truncate">{tag.name}</span>
                <span className="text-muted-foreground ml-auto text-xs">{tag.count}</span>
              </NavLink>
            ))}
          </>
        )}

        {/* className receives the active state, so it must stay a function —
            interpolating it into a template literal stringifies the function
            source and ships that as the class list. */}
        {trashCount > 0 && (
          <NavLink to="/trash" className={(state) => `${navClass(state)} mt-5`}>
            <Trash2 className="size-4" /> Trash
            <span className="text-muted-foreground ml-auto text-xs">{trashCount}</span>
          </NavLink>
        )}
      </ScrollArea>

      <div className="flex flex-col gap-0.5 border-t p-2">
        {/* A plain link, not a fetcher: the response is a file download, and the
            browser handles that better than any JavaScript would. */}
        <Button asChild variant="ghost" size="sm" className="w-full justify-start">
          <a href="/export" download>
            <Download className="size-4" /> Export all
          </a>
        </Button>

        <Form method="post" action="/logout">
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
            Sign out
          </Button>
        </Form>
      </div>
    </aside>
  );
}
