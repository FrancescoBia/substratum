import { useEffect, useRef, useState, type ReactNode } from "react";
import type { useFetcher } from "react-router";

type Fetcher = ReturnType<typeof useFetcher>;

/**
 * Whole-page drop target. Dropping anywhere is the fastest way to add images by
 * hand, so the target is the window rather than a small box the Owner has to
 * aim at — the visible dropzone is only the confirmation overlay.
 */
export function UploadDropzone({
  fetcher,
  children,
}: {
  fetcher: Fetcher;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  // Drag events fire per-element, so a plain boolean flickers as the pointer
  // crosses children. Counting enter/leave pairs is what keeps it steady.
  const depth = useRef(0);

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

      const body = new FormData();
      for (const file of files) body.append("files", file);
      fetcher.submit(body, {
        method: "post",
        action: "/upload",
        encType: "multipart/form-data",
      });
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
  }, [fetcher]);

  return (
    <>
      {children}
      {dragging && (
        <div className="bg-background/80 pointer-events-none fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="border-primary rounded-xl border-2 border-dashed px-10 py-8 text-center">
            <p className="font-medium">Drop to add to your Stream</p>
          </div>
        </div>
      )}
    </>
  );
}
