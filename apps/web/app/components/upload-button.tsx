import type { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";

/**
 * The explicit way in, for when dragging isn't convenient. Submits on selection
 * so there's no second "now upload" click.
 */
export function UploadButton({ fetcher }: { fetcher: ReturnType<typeof useFetcher> }) {
  const uploading = fetcher.state !== "idle";

  return (
    <fetcher.Form method="post" action="/upload" encType="multipart/form-data">
      <label>
        <input
          type="file"
          name="files"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(event) => {
            if (event.target.files?.length) {
              fetcher.submit(event.currentTarget.form, {
                method: "post",
                action: "/upload",
                encType: "multipart/form-data",
              });
            }
          }}
        />
        <Button asChild size="sm">
          <span className="cursor-pointer">{uploading ? "Uploading…" : "Upload images"}</span>
        </Button>
      </label>
    </fetcher.Form>
  );
}
