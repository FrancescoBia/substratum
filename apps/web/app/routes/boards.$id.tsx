import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { Input } from "@repo/ui/components/input";
import { eq } from "drizzle-orm";
import {
  LayoutDashboard,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useFetcher } from "react-router";
import {
  EmptyState,
  ImageGrid,
  useGridLayout,
  ViewHeader,
  type GridLayout,
} from "~/components/image-grid";
import { skipLightboxRevalidation } from "~/components/lightbox";
import { PublishPopover } from "~/components/publish-popover";
import { requireOwnerSession } from "~/auth/session.server";
import { db, schema } from "~/db/index.server";
import { instanceUrlFor } from "~/lib/config.server";
import { listBoardImages } from "~/lib/library.server";
import { countLabel } from "~/lib/media";
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

const LAYOUT_OPTIONS: { value: GridLayout; label: string; icon: LucideIcon }[] = [
  { value: "flat", label: "Grid view", icon: LayoutGrid },
  { value: "mosaic", label: "Mosaic view", icon: LayoutDashboard },
];

export default function BoardView({ loaderData }: Route.ComponentProps) {
  const { board, images, instanceUrl } = loaderData;
  const edit = useFetcher();
  const [renaming, setRenaming] = useState(false);
  const renameInput = useRef<HTMLInputElement>(null);
  const [layout, setLayout] = useGridLayout();

  const publicUrl = board.slug ? `${instanceUrl}/board/${board.slug}` : null;

  return (
    <div className="p-6">
      <ViewHeader title={board.name} subtitle={countLabel(images)}>
        <PublishPopover boardId={board.id} published={board.published} publicUrl={publicUrl} />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Board settings">
                <MoreHorizontal />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <Pencil /> Rename board
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <LayoutGrid /> Display
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-40">
                <DropdownMenuRadioGroup
                  value={layout}
                  onValueChange={(value: GridLayout) => setLayout(value)}
                >
                  {LAYOUT_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      <Icon /> {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                if (!confirm(`Delete the board "${board.name}"? The images stay in your Stream.`)) {
                  return;
                }
                edit.submit(
                  { intent: "delete", boardId: board.id },
                  { method: "post", action: "/boards" },
                );
              }}
            >
              <Trash2 /> Delete board
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ViewHeader>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent initialFocus={renameInput}>
          <DialogHeader>
            <DialogTitle>Rename board</DialogTitle>
          </DialogHeader>
          <edit.Form
            method="post"
            action="/boards"
            className="grid gap-4"
            onSubmit={() => setRenaming(false)}
          >
            <input type="hidden" name="intent" value="rename" />
            <input type="hidden" name="boardId" value={board.id} />
            <Input
              ref={renameInput}
              name="name"
              aria-label="Board name"
              defaultValue={board.name}
              required
              onFocus={(event) => event.currentTarget.select()}
            />
            <DialogFooter>
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <Button type="submit">Save</Button>
            </DialogFooter>
          </edit.Form>
        </DialogContent>
      </Dialog>

      {images.length === 0 ? (
        <EmptyState title="This board is empty">
          Open anything in your Stream and tick this board in its details.
        </EmptyState>
      ) : (
        <ImageGrid images={images} layout={layout} />
      )}
    </div>
  );
}
