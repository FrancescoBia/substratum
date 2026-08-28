import { Link, useLocation } from "react-router";
import type { GridImage } from "~/lib/library.server";

/**
 * The uniform grid the prototype settled on — aspect-cropped thumbnails, never
 * the originals. Selecting an Image is a URL change (`?image=`), so the detail
 * panel is shareable, reload-stable, and closable with the back button.
 */
export function ImageGrid({ images }: { images: GridImage[] }) {
  const location = useLocation();

  function linkTo(id: string) {
    const params = new URLSearchParams(location.search);
    params.set("image", id);
    return `${location.pathname}?${params}`;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {images.map((image) => (
        <Link
          key={image.id}
          to={linkTo(image.id)}
          preventScrollReset
          className="group relative block"
          aria-label={image.title ?? "Uploaded image"}
        >
          <img
            src={`/img/${image.id}/thumb`}
            alt={image.title ?? ""}
            width={image.width}
            height={image.height}
            loading="lazy"
            className="bg-muted aspect-[4/5] w-full rounded-lg object-cover transition group-hover:brightness-90"
          />
          {image.untriaged && (
            <span
              className="bg-primary ring-background absolute top-2 left-2 size-2 rounded-full ring-2"
              title="Not on any board or tagged yet"
            />
          )}
        </Link>
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-12 text-center">
      <h2 className="font-medium">{title}</h2>
      {children && (
        <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">{children}</p>
      )}
    </div>
  );
}

export function ViewHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-4 pb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  );
}
