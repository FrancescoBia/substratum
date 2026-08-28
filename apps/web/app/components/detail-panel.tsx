import { ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher, useLocation, useNavigate } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Separator } from "~/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import type { ImageDetail } from "~/lib/library.server";

type Board = { id: string; name: string; published: boolean };
type Tag = { name: string };

/**
 * A slide-in panel rather than a dialog, so the grid never disappears behind it
 * — the reason this variant won the prototype.
 */
export function DetailPanel({
  image,
  boards,
  allTags,
}: {
  image: ImageDetail | null;
  boards: Board[];
  allTags: Tag[];
}) {
  const navigate = useNavigate();
  const location = useLocation();

  function close() {
    const params = new URLSearchParams(location.search);
    params.delete("image");
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { preventScrollReset: true });
  }

  return (
    <Sheet open={image !== null} onOpenChange={(open) => !open && close()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-6 sm:max-w-105">
        {image && <DetailBody image={image} boards={boards} allTags={allTags} onClose={close} />}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({
  image,
  boards,
  allTags,
  onClose,
}: {
  image: ImageDetail;
  boards: Board[];
  allTags: Tag[];
  onClose: () => void;
}) {
  const edit = useFetcher();
  const [tagInput, setTagInput] = useState("");
  const [note, setNote] = useState(image.note);

  // The panel stays mounted while the selection changes, so local state has to
  // follow the Image rather than only initialising once.
  useEffect(() => {
    setNote(image.note);
    setTagInput("");
  }, [image.id, image.note]);

  function send(fields: Record<string, string>) {
    edit.submit(fields, { method: "post", action: `/image/${image.id}` });
  }

  const suggestions = allTags
    .map((tag) => tag.name)
    .filter((name) => !image.tags.includes(name) && name.includes(tagInput.trim().toLowerCase()))
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-5 text-sm">
      <SheetTitle className="sr-only">{image.sourcePageTitle ?? "Image"}</SheetTitle>

      <a href={`/img/${image.id}/original`} target="_blank" rel="noreferrer">
        <img
          src={`/img/${image.id}/medium`}
          alt={image.sourcePageTitle ?? ""}
          className="bg-muted w-full rounded-lg"
        />
      </a>

      {/* Provenance only when there is any: an uploaded Image has no source. */}
      <div>
        {image.sourcePageUrl ? (
          <>
            <div className="font-medium">{image.sourcePageTitle || "Untitled page"}</div>
            <a
              href={image.sourcePageUrl}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground inline-flex items-center gap-1 hover:underline"
            >
              {hostOf(image.sourcePageUrl)}
              <ExternalLink className="size-3" />
            </a>
          </>
        ) : (
          <div className="text-muted-foreground">Uploaded — no source page</div>
        )}
        <div className="text-muted-foreground text-xs">
          {image.width}×{image.height} · {image.format.toUpperCase()} ·{" "}
          {formatBytes(image.byteSize)} · saved{" "}
          {new Date(image.savedAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Boards
        </div>
        {boards.length === 0 && (
          <p className="text-muted-foreground text-xs">
            No boards yet — create one from the sidebar.
          </p>
        )}
        {boards.map((board) => (
          <label key={board.id} className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={image.boardIds.includes(board.id)}
              onCheckedChange={() => send({ intent: "toggle-board", boardId: board.id })}
            />
            <span>{board.name}</span>
            {board.published && (
              <Badge variant="outline" className="ml-auto text-[10px]">
                published
              </Badge>
            )}
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Tags
        </div>
        {image.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {image.tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="cursor-pointer"
                title="Remove tag"
                onClick={() => send({ intent: "remove-tag", tag })}
              >
                {tag} ×
              </Badge>
            ))}
          </div>
        )}
        <Input
          placeholder="Add a tag…"
          value={tagInput}
          onChange={(event) => setTagInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && tagInput.trim()) {
              event.preventDefault();
              send({ intent: "add-tag", tag: tagInput });
              setTagInput("");
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
                onClick={() => {
                  send({ intent: "add-tag", tag: name });
                  setTagInput("");
                }}
              >
                + {name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Note
        </div>
        <Textarea
          placeholder="Private note…"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            if (note !== image.note) send({ intent: "set-note", note });
          }}
        />
      </div>

      <Separator />

      {image.deletedAt ? (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => send({ intent: "restore" })}
        >
          <RotateCcw className="size-4" /> Restore
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive w-fit"
          onClick={() => {
            send({ intent: "trash" });
            onClose();
          }}
        >
          <Trash2 className="size-4" /> Move to Trash
        </Button>
      )}
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
