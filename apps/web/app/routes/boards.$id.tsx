import { eq } from "drizzle-orm";
import { Globe, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFetcher } from "react-router";
import { EmptyState, ImageGrid, ViewHeader } from "~/components/image-grid";
import { skipLightboxRevalidation } from "~/components/lightbox";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { requireOwnerSession } from "~/auth/session.server";
import { db, schema } from "~/db/index.server";
import { instanceUrlFor } from "~/lib/config.server";
import { listBoardImages } from "~/lib/library.server";
import type { Route } from "./+types/boards.$id";

// Opening or stepping the full-size viewer only moves `?view=`, which no loader
// here reads. Without this, every arrow key would re-run these queries.
export const shouldRevalidate = skipLightboxRevalidation;

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.board.name} · Substratum` : "Board · Substratum" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOwnerSession(request);

  const [board] = await db.select().from(schema.boards).where(eq(schema.boards.id, params.id));
  if (!board) throw new Response("Board not found", { status: 404 });

  return {
    board,
    images: await listBoardImages(board.id),
    instanceUrl: instanceUrlFor(request),
  };
}

export default function BoardView({ loaderData }: Route.ComponentProps) {
  const { board, images, instanceUrl } = loaderData;
  const edit = useFetcher();
  const [renaming, setRenaming] = useState(false);

  const publicUrl = board.slug ? `${instanceUrl}/board/${board.slug}` : null;

  return (
    <div className="p-6">
      <ViewHeader
        title={renaming ? "" : board.name}
        subtitle={`${images.length} image${images.length === 1 ? "" : "s"}`}
      >
        {board.published ? (
          <edit.Form method="post" action="/boards">
            <input type="hidden" name="intent" value="unpublish" />
            <input type="hidden" name="boardId" value={board.id} />
            <Button type="submit" variant="outline" size="sm">
              <Globe className="size-4" /> Unpublish
            </Button>
          </edit.Form>
        ) : (
          <edit.Form method="post" action="/boards">
            <input type="hidden" name="intent" value="publish" />
            <input type="hidden" name="boardId" value={board.id} />
            <Button type="submit" variant="outline" size="sm">
              <Globe className="size-4" /> Publish
            </Button>
          </edit.Form>
        )}

        <Button variant="ghost" size="sm" onClick={() => setRenaming((value) => !value)}>
          Rename
        </Button>

        <edit.Form
          method="post"
          action="/boards"
          onSubmit={(event) => {
            if (!confirm(`Delete the board "${board.name}"? The images stay in your Stream.`)) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="boardId" value={board.id} />
          <Button type="submit" variant="ghost" size="sm" className="text-destructive">
            <Trash2 className="size-4" />
          </Button>
        </edit.Form>
      </ViewHeader>

      {renaming && (
        <edit.Form
          method="post"
          action="/boards"
          className="mb-6 flex max-w-sm gap-2"
          onSubmit={() => setRenaming(false)}
        >
          <input type="hidden" name="intent" value="rename" />
          <input type="hidden" name="boardId" value={board.id} />
          <Input name="name" defaultValue={board.name} autoFocus />
          <Button type="submit" size="sm">
            Save
          </Button>
        </edit.Form>
      )}

      {/* The slug is frozen at first publish, so this link keeps working even
          after the board is renamed. */}
      {board.published && publicUrl && (
        <p className="text-muted-foreground mb-6 text-sm">
          Published at{" "}
          <a href={`/board/${board.slug}`} target="_blank" rel="noreferrer" className="underline">
            {publicUrl}
          </a>
        </p>
      )}

      {images.length === 0 ? (
        <EmptyState title="This board is empty">
          Open an image from your Stream and tick this board in the panel.
        </EmptyState>
      ) : (
        <ImageGrid images={images} allowLayoutSwitch />
      )}
    </div>
  );
}
