import { useFetcher } from "react-router";
import { EmptyState, ImageGrid, ViewHeader } from "~/components/image-grid";
import { skipLightboxRevalidation } from "~/components/lightbox";
import { UploadButton } from "~/components/upload-button";
import { requireOwnerSession } from "~/auth/session.server";
import { listStream } from "~/lib/library.server";
import type { Route } from "./+types/stream";

// Opening or stepping the full-size viewer only moves `?view=`, which no loader
// here reads. Without this, every arrow key would re-run these queries.
export const shouldRevalidate = skipLightboxRevalidation;

export function meta() {
  return [{ title: "Stream · Substratum" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOwnerSession(request);
  return { images: await listStream() };
}

export default function Stream({ loaderData }: Route.ComponentProps) {
  const { images } = loaderData;
  const upload = useFetcher();

  return (
    <div className="p-6">
      <ViewHeader
        title="Stream"
        subtitle={
          images.length === 0
            ? "Nothing saved yet"
            : `${images.length} image${images.length === 1 ? "" : "s"}`
        }
      >
        <UploadButton fetcher={upload} />
      </ViewHeader>

      {upload.data?.errors?.length ? (
        <ul className="border-destructive/50 text-destructive mb-6 rounded-lg border p-4 text-sm">
          {upload.data.errors.map((message: string) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      {images.length === 0 ? (
        <EmptyState title="Your Stream is empty">
          Drag images anywhere onto this page to add them, or use the Upload button. With the
          browser extension installed you can also right-click any image on the web and save it
          here.
        </EmptyState>
      ) : (
        <ImageGrid images={images} allowLayoutSwitch />
      )}
    </div>
  );
}
