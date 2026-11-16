import { EmptyState, ImageGrid, ViewHeader } from "~/components/image-grid";
import { skipLightboxRevalidation } from "~/components/lightbox";
import { requireOwnerSession } from "~/auth/session.server";
import { listTagImages } from "~/lib/library.server";
import { countLabel } from "~/lib/media";
import type { Route } from "./+types/tag.$name";
import { TAGS_ENABLED } from "~/lib/features";

// Opening or stepping the full-size viewer only moves `?view=`, which no loader
// here reads. Without this, every arrow key would re-run these queries.
export const shouldRevalidate = skipLightboxRevalidation;

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `#${params.name} · Substratum` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOwnerSession(request);
  // Hidden while tags are switched off; the route stays so it can come back.
  if (!TAGS_ENABLED) throw new Response("Not Found", { status: 404 });
  return { name: params.name, images: await listTagImages(params.name) };
}

export default function TagView({ loaderData }: Route.ComponentProps) {
  const { name, images } = loaderData;

  return (
    <div className="p-6">
      <ViewHeader title={`#${name}`} subtitle={countLabel(images)} />
      {images.length === 0 ? (
        <EmptyState title="Nothing tagged this yet" />
      ) : (
        <ImageGrid images={images} allowLayoutSwitch />
      )}
    </div>
  );
}
