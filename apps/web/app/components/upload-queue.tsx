import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRevalidator } from "react-router";
import type { UploadResult } from "~/routes/upload";

/**
 * The Board or Tag the Owner is looking at while they drop. Both are views onto
 * the Stream rather than places an Image lives, so dropping on one offers to
 * file the new Images there — it never diverts them away from the Stream.
 */
export type UploadDestination =
  | { kind: "board"; id: string; name: string }
  | { kind: "tag"; name: string };

/**
 * How many files are in flight at once. One request per file is what makes
 * per-file progress possible at all; the cap is what stops a fifty-image drop
 * from starting fifty sharp pipelines and holding every file in memory.
 */
const CONCURRENCY = 3;

/** How long a clean result stays on screen before it clears itself. */
const SUCCESS_DISMISS_MS = 2000;

export type UploadState = {
  /** True from the first queued file until the last one settles. */
  running: boolean;
  total: number;
  completed: number;
  failed: number;
  errors: string[];
};

const IDLE: UploadState = { running: false, total: 0, completed: 0, failed: 0, errors: [] };

type QueueItem = { file: File; destination?: UploadDestination };

type UploadContextValue = {
  state: UploadState;
  start: (files: File[], destination?: UploadDestination) => void;
  dismiss: () => void;
};

const UploadContext = createContext<UploadContextValue | null>(null);

export function useUpload() {
  const value = useContext(UploadContext);
  if (!value) throw new Error("useUpload must be used inside an UploadProvider.");
  return value;
}

/**
 * Posts one file and reports what went wrong, if anything. The server already
 * prefixes its messages with the filename, so its wording is passed through
 * untouched and only transport failures are worded here.
 */
async function uploadOne({ file, destination }: QueueItem): Promise<string | null> {
  const body = new FormData();
  body.append("files", file);
  if (destination?.kind === "board") body.append("boardId", destination.id);
  if (destination?.kind === "tag") body.append("tag", destination.name);

  const name = file.name || "image";

  try {
    const response = await fetch("/upload", { method: "POST", body });
    if (!response.ok) return `${name}: the server returned ${response.status}.`;

    const result = (await response.json()) as UploadResult;
    if (result.errors.length > 0) return result.errors[0];
    return result.uploaded === 1 ? null : `${name}: it wasn't saved.`;
  } catch {
    return `${name}: couldn't reach the server.`;
  }
}

/**
 * Owns every manual import in the app.
 *
 * One request per file rather than one for the batch: on a self-hosted instance
 * the bytes arrive almost immediately and the wait is sharp re-encoding on the
 * server, so a transfer bar would sit at 100% for the whole time the Owner is
 * actually waiting. Counting files that have finished ingesting is the only
 * number that means anything here.
 */
export function UploadProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UploadState>(IDLE);
  const { revalidate } = useRevalidator();

  // The queue and the drain flag are refs rather than state: workers read them
  // between awaits, and a value a render behind would let a file be picked up
  // twice or not at all.
  const queue = useRef<QueueItem[]>([]);
  const draining = useRef(false);

  const drain = useCallback(async () => {
    draining.current = true;

    async function worker() {
      for (;;) {
        const item = queue.current.shift();
        if (!item) return;

        const error = await uploadOne(item);
        setState((prev) => ({
          ...prev,
          completed: prev.completed + 1,
          failed: error ? prev.failed + 1 : prev.failed,
          errors: error ? [...prev.errors, error] : prev.errors,
        }));
      }
    }

    // A second batch dropped mid-import joins this same queue, so the loop
    // re-checks rather than assuming the first pass emptied it.
    while (queue.current.length > 0) {
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, queue.current.length) }, worker),
      );
    }

    draining.current = false;

    // One revalidation for the whole import. The library loader runs five
    // queries and the grid relays out, which isn't worth repeating per file
    // when the card is already saying what's happening.
    void revalidate();
    setState((prev) => ({ ...prev, running: false }));
  }, [revalidate]);

  const start = useCallback(
    (files: File[], destination?: UploadDestination) => {
      if (files.length === 0) return;

      // Each entry carries its own destination, so a batch dropped on a Board
      // and one dropped on the Stream stay correctly filed in a shared queue.
      queue.current.push(...files.map((file) => ({ file, destination })));

      setState((prev) =>
        prev.running
          ? { ...prev, total: prev.total + files.length }
          : { running: true, total: files.length, completed: 0, failed: 0, errors: [] },
      );

      if (!draining.current) void drain();
    },
    [drain],
  );

  const dismiss = useCallback(() => setState(IDLE), []);

  // A clean import needs no acknowledgement, so it clears itself. One with
  // failures stays until it is read and dismissed.
  useEffect(() => {
    if (state.running || state.total === 0 || state.failed > 0) return;
    const timer = setTimeout(() => setState(IDLE), SUCCESS_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [state.running, state.total, state.failed]);

  return (
    <UploadContext.Provider value={{ state, start, dismiss }}>{children}</UploadContext.Provider>
  );
}
