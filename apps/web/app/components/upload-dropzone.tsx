import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

type Fetcher = ReturnType<typeof useFetcher>;

/**
 * The Board or Tag the Owner is looking at while they drop. Both are views onto
 * the Stream rather than places an Image lives, so dropping on one offers to
 * file the new Images there — it never diverts them away from the Stream.
 */
export type UploadDestination =
  | { kind: "board"; id: string; name: string }
  | { kind: "tag"; name: string };

/**
 * Whole-page drop target. Dropping anywhere is the fastest way to add images by
 * hand, so the target is the window rather than a small box the Owner has to
 * aim at — the visible dropzone is only the confirmation overlay.
 */
export function UploadDropzone({
  fetcher,
  destination,
  children,
}: {
  fetcher: Fetcher;
  destination?: UploadDestination;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  // Drag events fire per-element, so a plain boolean flickers as the pointer
  // crosses children. Counting enter/leave pairs is what keeps it steady.
  const depth = useRef(0);

  const upload = useCallback(
    (files: File[], to?: UploadDestination) => {
      const body = new FormData();
      for (const file of files) body.append("files", file);
      if (to?.kind === "board") body.append("boardId", to.id);
      if (to?.kind === "tag") body.append("tag", to.name);

      fetcher.submit(body, {
        method: "post",
        action: "/upload",
        encType: "multipart/form-data",
      });
      setPendingFiles(null);
    },
    [fetcher],
  );

  // Only whether there is a destination matters to the drop handler; keeping the
  // dependency a boolean stops the listeners re-binding on every render.
  const hasDestination = destination !== undefined;

  useEffect(() => {
    function hasFiles(event: DragEvent) {
      return Array.from(event.dataTransfer?.types ?? []).includes("Files");
    }

    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth.current += 1;
      setDragging(true);
    }

    function onDragOver(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
    }

    function onDragLeave(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    }

    function onDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);

      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length === 0) return;

      if (hasDestination) {
        setPendingFiles(files);
      } else {
        upload(files);
      }
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [hasDestination, upload]);

  return (
    <>
      {children}
      {dragging && (
        <div className="bg-background/80 pointer-events-none fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="border-primary rounded-xl border-2 border-dashed px-10 py-8 text-center">
            <p className="font-medium">
              {destination ? "Drop to choose how to import" : "Drop to add to your Stream"}
            </p>
          </div>
        </div>
      )}

      {destination && (
        <Dialog
          open={pendingFiles !== null}
          onOpenChange={(open) => {
            if (!open) setPendingFiles(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Import {pendingFiles?.length ?? 0} image
                {pendingFiles?.length === 1 ? "" : "s"}?
              </DialogTitle>
              <DialogDescription>
                {destination.kind === "board"
                  ? `Import them to your Stream only, or also add them to “${destination.name}”.`
                  : `Import them to your Stream only, or also tag them “#${destination.name}”.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => pendingFiles && upload(pendingFiles)}
              >
                Import only
              </Button>
              <Button onClick={() => pendingFiles && upload(pendingFiles, destination)}>
                {destination.kind === "board" ? "Import and add to board" : "Import and tag"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
