import { isNotNull } from "drizzle-orm";
import { Outlet, useFetcher, useLocation } from "react-router";
import { DetailPanel } from "~/components/detail-panel";
import { skipLightboxRevalidation } from "~/components/lightbox";
import { Sidebar } from "~/components/sidebar";
import { UploadDropzone, type UploadDestination } from "~/components/upload-dropzone";
import { requireOwnerSession } from "~/auth/session.server";
import { db, schema } from "~/db/index.server";
import { getImageDetail, listBoards, listStream, listTags } from "~/lib/library.server";
import type { Route } from "./+types/library";

// Opening or stepping the full-size viewer only moves `?view=`, which no loader
// here reads. Without this, every arrow key would re-run these queries.
export const shouldRevalidate = skipLightboxRevalidation;

/**
 * The shell every library view renders inside: sidebar, the selected Image's
 * detail panel, and the page-wide upload dropzone. Loading the selection here
 * rather than per-view means the panel works identically from the Stream, a
 * Board, a Tag, or the Trash.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const owner = await requireOwnerSession(request);

  const selectedId = new URL(request.url).searchParams.get("image");

  const [boards, tags, stream, trashRows, selected] = await Promise.all([
    listBoards(),
    listTags(),
    listStream(),
    db
      .select({ id: schema.images.id })
      .from(schema.images)
      .where(isNotNull(schema.images.deletedAt)),
    selectedId ? getImageDetail(selectedId) : Promise.resolve(null),
  ]);

  return {
    email: owner.email,
    boards,
    tags,
    untriagedCount: stream.filter((image) => image.untriaged).length,
    trashCount: trashRows.length,
    selected,
  };
}

export default function Library({ loaderData }: Route.ComponentProps) {
  const { boards, tags, untriagedCount, trashCount, email, selected } = loaderData;
  const upload = useFetcher();
  const location = useLocation();

  // Which view the drop lands on, if it is one an Image can be filed into. The
  // Stream, the Trash and triage have no destination, so a drop there just
  // imports.
  const board = boards.find((board) => location.pathname === `/boards/${board.id}`);
  const tag = tags.find((tag) => location.pathname === `/tag/${encodeURIComponent(tag.name)}`);
  const destination: UploadDestination | undefined = board
    ? { kind: "board", id: board.id, name: board.name }
    : tag
      ? { kind: "tag", name: tag.name }
      : undefined;

  return (
    <UploadDropzone fetcher={upload} destination={destination}>
      <div className="flex h-screen">
        <Sidebar
          boards={boards}
          tags={tags}
          untriagedCount={untriagedCount}
          trashCount={trashCount}
          email={email}
        />

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet context={{ upload }} />
        </main>

        <DetailPanel image={selected} boards={boards} allTags={tags} />
      </div>
    </UploadDropzone>
  );
}
