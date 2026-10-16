import { Button } from "@repo/ui/components/button";
import { Progress } from "@repo/ui/components/progress";
import { XIcon } from "lucide-react";
import { useUpload } from "~/components/upload-queue";

/**
 * The one place an import reports itself. It sits in the library shell rather
 * than in a view because a drop can start from anywhere and the Owner is free
 * to navigate while it runs.
 */
export function UploadProgress() {
  const { state, dismiss } = useUpload();

  if (state.total === 0) return null;

  const succeeded = state.completed - state.failed;

  // Every byte is up and only the server's answers are outstanding. A full bar
  // would read as finished, and nothing here can say how far along the server
  // is — so the bar sweeps, which is the honest shape for "working".
  const processing = state.running && state.processing > 0 && state.sentBytes >= state.totalBytes;

  const value = processing
    ? null
    : state.totalBytes === 0
      ? 100
      : Math.round((state.sentBytes / state.totalBytes) * 100);

  // Once an import has failed, a full bar would say the opposite of the count
  // beside it. The numbers and the reasons carry the result on their own.
  const showBar = state.running || state.failed === 0;

  const heading = state.running
    ? processing
      ? "Processing…"
      : state.total === 1
        ? "Uploading…"
        : `Uploading ${state.completed} of ${state.total}`
    : state.failed > 0
      ? `${succeeded} uploaded, ${state.failed} failed`
      : `${succeeded} uploaded`;

  return (
    <div
      data-testid="upload-progress"
      className="bg-card text-card-foreground fixed right-6 bottom-6 z-50 w-80 rounded-xl border p-4 shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{heading}</p>
        {!state.running && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="-mt-1 -mr-1"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            <XIcon />
          </Button>
        )}
      </div>

      {showBar && <Progress value={value} aria-label={heading} className="mt-3" />}

      {state.errors.length > 0 && (
        <ul className="text-destructive mt-3 space-y-1 text-sm">
          {state.errors.map((message, index) => (
            <li key={`${index}-${message}`}>{message}</li>
          ))}
        </ul>
      )}

      {/* Announced once, at the end. A live region on the running count would
          read out every file as it landed. */}
      <p className="sr-only" aria-live="polite">
        {state.running ? "" : heading}
      </p>
    </div>
  );
}
