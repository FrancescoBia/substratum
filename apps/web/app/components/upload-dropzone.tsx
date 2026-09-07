import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { UploadProgress } from "~/components/upload-progress";
import { UploadProvider, useUpload, type UploadDestination } from "~/components/upload-queue";

export type { UploadDestination };

/**
 * Whole-page drop target, plus the queue every manual import runs through and
 * the card that reports it. The provider wraps the page rather than a view so
 * that the Upload button, a drop onto a Board, and the progress card all share
 * one import — before this, the button and the dropzone each had their own, and
 * a drop's errors had nowhere to appear.
 */
export function UploadDropzone({
  destination,
  children,
}: {
  destination?: UploadDestination;
  children: ReactNode;
}) {
  return (
    <UploadProvider>
      <DropTarget destination={destination}>{children}</DropTarget>
      <UploadProgress />
    </UploadProvider>
  );
}

/**
 * Dropping anywhere is the fastest way to add images by hand, so the target is
 * the window rather than a small box the Owner has to aim at — the visible
 * dropzone is only the confirmation overlay.
 */
function DropTarget({
  destination,
  children,
}: {
  destination?: UploadDestination;
  children: ReactNode;
}) {
  const { start } = useUpload();
  const [dragging, setDragging] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  // Drag events fire per-element, so a plain boolean flickers as the pointer
  // crosses children. Counting enter/leave pairs is what keeps it steady.
  const depth = useRef(0);

  const upload = useCallback(
    (files: File[], to?: UploadDestination) => {
      start(files, to);
      setPendingFiles(null);
    },
    [start],
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
