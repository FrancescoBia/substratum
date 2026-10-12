import { Badge } from "@repo/ui/components/badge";
import { Button, buttonVariants } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import { Separator } from "@repo/ui/components/separator";
import { Sheet, SheetContent, SheetTitle } from "@repo/ui/components/sheet";
import { Textarea } from "@repo/ui/components/textarea";
import { ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFetcher, useLocation, useNavigate } from "react-router";
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
        {/* Keyed by id so selecting a different Image remounts the body with
            fresh field state — the panel stays mounted across selections, and
            an effect that reset state instead also fired on every edit's
            revalidation, wiping half-typed input. */}
        {image && (
          <DetailBody
            key={image.id}
            image={image}
            boards={boards}
            allTags={allTags}
            onClose={close}
          />
        )}
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
  const [title, setTitle] = useState(image.title ?? "");
  const [sourcePageUrl, setSourcePageUrl] = useState(image.sourcePageUrl ?? "");
  // Checked here as well as in the action, so a typo is reported next to the
  // field instead of silently doing nothing.
  const [urlError, setUrlError] = useState<string | null>(null);

  function send(fields: Record<string, string>) {
    edit.submit(fields, { method: "post", action: `/image/${image.id}` });
  }

  const suggestions = allTags
    .map((tag) => tag.name)
    .filter((name) => !image.tags.includes(name) && name.includes(tagInput.trim().toLowerCase()))
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-5 text-sm">
      <SheetTitle className="sr-only">{image.displayTitle ?? "Image"}</SheetTitle>

      <a href={`/img/${image.id}/original`} target="_blank" rel="noreferrer">
        <img
          src={`/img/${image.id}/medium`}
          alt={image.displayTitle ?? ""}
          className="bg-muted w-full rounded-lg"
        />
      </a>

      {/* Both fields are editable and both can start empty: a captured title is
          often unhelpful, and an uploaded Image arrives with no source at all. */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Name
          </div>
          <Input
            placeholder={image.sourcePageTitle || "Untitled"}
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              if (title.trim() !== (image.title ?? "")) send({ intent: "set-title", title });
            }}
          />
          {/* Says why the field looks empty but the Image still has a name. */}
          {!image.title && image.sourcePageTitle && (
            <p className="text-muted-foreground text-xs">Falling back to the source page title.</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Source page
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              type="url"
              inputMode="url"
              placeholder="https://…"
              value={sourcePageUrl}
              aria-invalid={urlError !== null}
              onChange={(event) => {
                setSourcePageUrl(event.target.value);
                setUrlError(null);
              }}
              onBlur={() => {
                const next = sourcePageUrl.trim();
                if (next === (image.sourcePageUrl ?? "")) return;
                if (next && !isHttpUrl(next)) {
                  setUrlError("Enter an http or https URL.");
                  return;
                }
                setUrlError(null);
                send({ intent: "set-source-page-url", sourcePageUrl: next });
              }}
            />
            {/* A plain anchor, not `Button`: Base UI forces role="button" onto a
                rendered link. */}
            {image.sourcePageUrl && (
              <a
                href={image.sourcePageUrl}
                target="_blank"
                rel="noreferrer"
                title={`Open ${hostOf(image.sourcePageUrl)}`}
                className={buttonVariants({ variant: "ghost", size: "icon" })}
              >
                <ExternalLink className="size-4" />
                <span className="sr-only">Open source page</span>
              </a>
            )}
          </div>
          {urlError ? (
            <p className="text-destructive text-xs">{urlError}</p>
          ) : (
            !image.sourcePageUrl && (
              <p className="text-muted-foreground text-xs">Uploaded — no source page</p>
            )
          )}
        </div>

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

/** Mirrors the action's gate: only http and https are ever stored. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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
