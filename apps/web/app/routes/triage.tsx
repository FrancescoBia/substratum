import { ArrowRight, Check, ExternalLink, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { requireOwnerSession } from "~/auth/session.server";
import { listBoards, listTags, listUntriaged } from "~/lib/library.server";
import type { Route } from "./+types/triage";

export function meta() {
  return [{ title: "Triage · Substratum" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOwnerSession(request);

  // Untriaged means no Boards and no Tags, so the queue needs no per-Image
  // detail fetch — everything shown here comes from this one query.
  const [queue, boards, tags] = await Promise.all([listUntriaged(), listBoards(), listTags()]);
  return { queue, boards, tags };
}

/**
 * The focused inbox from the prototype: one Image at a time, boards on number
 * keys, tag by typing. Built for clearing a backlog in one sitting, which the
 * detail panel is too slow for.
 *
 * The queue is captured once on entry and walked locally. Filing an Image makes
 * it triaged, so a live-updating queue would reshuffle underneath the cursor.
 */
export default function Triage({ loaderData }: Route.ComponentProps) {
  const { boards, tags } = loaderData;

  // Snapshotted on mount, and this genuinely matters: filing an Image makes it
  // triaged, so every edit revalidates the loader and shrinks its queue. Reading
  // that live would pull items out from under the cursor — you would file one
  // image and be told the inbox was empty.
  const [queue] = useState(() => loaderData.queue);

  const [cursor, setCursor] = useState(0);
  const edit = useFetcher();

  const current = queue[cursor];
  const currentId = current?.id;
  const total = queue.length;

  // Every Image here starts with nothing assigned, so local state is the whole
  // truth for this session — no per-Image loading as the cursor moves.
  const [assigned, setAssigned] = useState<Record<string, string[]>>({});
  const [tagged, setTagged] = useState<Record<string, string[]>>({});
  const [tagInput, setTagInput] = useState("");

  const boardIds = currentId ? (assigned[currentId] ?? []) : [];
  const imageTags = currentId ? (tagged[currentId] ?? []) : [];

  function toggleBoard(boardId: string) {
    if (!currentId) return;
    const next = boardIds.includes(boardId)
      ? boardIds.filter((id) => id !== boardId)
      : [...boardIds, boardId];
    setAssigned((state) => ({ ...state, [currentId]: next }));
    edit.submit(
      { intent: "toggle-board", boardId },
      { method: "post", action: `/image/${currentId}` },
    );
  }

  function addTag(name: string) {
    if (!currentId || !name.trim()) return;
    const normalized = name.trim().toLowerCase().replace(/\s+/g, "-");
    if (!imageTags.includes(normalized)) {
      setTagged((state) => ({ ...state, [currentId]: [...imageTags, normalized] }));
    }
    edit.submit({ intent: "add-tag", tag: name }, { method: "post", action: `/image/${currentId}` });
    setTagInput("");
  }

  const advance = () => setCursor((value) => value + 1);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const element = document.activeElement;
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return;
      if (!currentId) return;

      const digit = Number(event.key);
      if (digit >= 1 && digit <= Math.min(boards.length, 9)) {
        event.preventDefault();
        toggleBoard(boards[digit - 1].id);
        return;
      }
      if (event.key === "s" || event.key === "Enter" || event.key === "ArrowRight") {
        event.preventDefault();
        advance();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (total === 0 || cursor >= total) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="text-center">
          <Check className="text-muted-foreground mx-auto size-8" />
          <h1 className="mt-3 text-xl font-semibold tracking-tight">
            {total === 0 ? "Nothing to triage" : "End of the queue"}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {total === 0
              ? "Every image is on a board or tagged."
              : // Not "you filed N" — skipping is a normal move, and anything
                // skipped is still untriaged and waiting here next time.
                `Worked through ${total} image${total === 1 ? "" : "s"}. Anything you skipped is still waiting.`}
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/">Back to Stream</Link>
          </Button>
        </div>
      </div>
    );
  }

  const suggestions = tags
    .map((tag) => tag.name)
    .filter((name) => !imageTags.includes(name))
    .slice(0, 5);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">Triage</h1>
        <Badge variant="secondary">
          {cursor + 1} of {total}
        </Badge>
        <span className="text-muted-foreground ml-auto text-xs">
          {boards.length > 0 && `1–${Math.min(boards.length, 9)} boards · `}s skip
        </span>
      </header>

      <div className="grid min-h-0 flex-1 md:grid-cols-[1fr_340px]">
        <div className="bg-muted/40 flex items-center justify-center overflow-hidden p-6">
          <img
            key={currentId}
            src={`/img/${currentId}/medium`}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain shadow-lg"
          />
        </div>

        <div className="flex flex-col gap-4 border-l p-5 text-sm">
          {current.sourcePageUrl ? (
            <div>
              <div className="font-medium">{current.title || "Untitled page"}</div>
              <a
                href={current.sourcePageUrl}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground inline-flex items-center gap-1 text-xs hover:underline"
              >
                {hostOf(current.sourcePageUrl)}
                <ExternalLink className="size-3" />
              </a>
            </div>
          ) : (
            <div className="text-muted-foreground text-xs">Uploaded — no source page</div>
          )}

          <div className="flex flex-col gap-2">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Boards
            </div>
            {boards.length === 0 && (
              <p className="text-muted-foreground text-xs">
                No boards yet — create one from the sidebar.
              </p>
            )}
            {boards.map((board, index) => (
              <label key={board.id} className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={boardIds.includes(board.id)}
                  onCheckedChange={() => toggleBoard(board.id)}
                />
                <span>{board.name}</span>
                {index < 9 && (
                  <kbd className="bg-muted text-muted-foreground ml-auto rounded px-1.5 text-[10px]">
                    {index + 1}
                  </kbd>
                )}
              </label>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Tags
            </div>
            {imageTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {imageTags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            <Input
              placeholder="Add a tag…"
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag(tagInput);
                }
              }}
            />
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {suggestions.map((name) => (
                  <Badge
                    key={name}
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() => addTag(name)}
                  >
                    + {name}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="mt-auto flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              title="Move to Trash"
              onClick={() => {
                edit.submit({ intent: "trash" }, { method: "post", action: `/image/${currentId}` });
                advance();
              }}
            >
              <Trash2 className="size-4" />
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={advance}>
              Skip
            </Button>
            <Button size="sm" className="flex-1" onClick={advance}>
              Next <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
