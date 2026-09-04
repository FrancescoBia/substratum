import { EmptyState, ImageGrid, ViewHeader } from "~/components/image-grid";
import { skipLightboxRevalidation } from "~/components/lightbox";
import { requireOwnerSession } from "~/auth/session.server";
import { listTagImages } from "~/lib/library.server";
import type { Route } from "./+types/tag.$name";

// Opening or stepping the full-size viewer only moves `?view=`, which no loader
// here reads. Without this, every arrow key would re-run these queries.
export const shouldRevalidate = skipLightboxRevalidation;

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `#${params.name} · Substratum` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOwnerSession(request);
  return { name: params.name, images: await listTagImages(params.name) };
}

export default function TagView({ loaderData }: Route.ComponentProps) {
  const { name, images } = loaderData;

  return (
    <div className="p-6">
      <ViewHeader
        title={`#${name}`}
        subtitle={`${images.length} image${images.length === 1 ? "" : "s"}`}
      />
      {images.length === 0 ? (
        <EmptyState title="Nothing tagged this yet" />
      ) : (
        <ImageGrid images={images} />
      )}
    </div>
  );
}
