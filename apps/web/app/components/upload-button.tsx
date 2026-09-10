import { Button } from "@repo/ui/components/button";
import { useUpload } from "~/components/upload-queue";

/**
 * The explicit way in, for when dragging isn't convenient. Uploads on selection
 * so there's no second "now upload" click.
 */
export function UploadButton() {
  const { start, state } = useUpload();

  return (
    <label>
      <input
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) start(files);
          // Picking the same file twice in a row fires no change event unless
          // the input is cleared first.
          event.target.value = "";
        }}
      />
      <Button asChild size="sm">
        <span className="cursor-pointer">{state.running ? "Uploading…" : "Upload images"}</span>
      </Button>
    </label>
  );
}
