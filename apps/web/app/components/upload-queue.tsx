import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "@repo/shared";
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
 * What the file picker offers. Images of any kind — the server says which it
 * can't take — but only the video types it stores, since a picker is a hint
 * about what will work and a drop is not.
 */
export const UPLOAD_ACCEPT = "image/*,video/mp4,video/quicktime,video/webm";

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
  /** Every queued file's size, summed — what the bar fills towards. */
  totalBytes: number;
  /**
   * How much of that has gone up. A file that settles counts in full, sent or
   * not, so a refusal or a failure never leaves the bar short of the end.
   */
  sentBytes: number;
  /** Files whose last byte has gone up and whose answer hasn't come back. */
  processing: number;
};

const IDLE: UploadState = {
  running: false,
  total: 0,
  completed: 0,
  failed: 0,
  errors: [],
  totalBytes: 0,
  sentBytes: 0,
  processing: 0,
};

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

/** How a file's upload reports itself while it runs. */
type UploadCallbacks = {
  /** Bytes of this file sent so far — the multipart envelope prorated away. */
  onProgress: (sent: number) => void;
  /** The last byte has gone; the server is working on it now. */
  onSent: () => void;
};

/**
 * POSTs a form, reporting progress as it goes up.
 *
 * `XMLHttpRequest` rather than `fetch`, because only it reports an upload's
 * progress. Resolves with whatever the server answered; rejects only when no
 * answer came at all.
 */
function post(
  body: FormData,
  fileSize: number,
  { onProgress, onSent }: UploadCallbacks,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/upload");

    // The request is the file plus a multipart envelope a few hundred bytes
    // long, so its own total runs slightly over the file's. Scaling back to the
    // file keeps a queue's sum equal to the sizes it started from.
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * fileSize));
      }
    };
    request.upload.onload = () => onSent();

    request.onload = () => resolve({ status: request.status, text: request.responseText });
    request.onerror = () => reject(new Error("The request failed."));
    request.onabort = () => reject(new Error("The request was aborted."));
    request.send(body);
  });
}

/**
 * Posts one file and reports what went wrong, if anything. The server already
 * prefixes its messages with the filename, so its wording is passed through
 * untouched and only transport failures are worded here.
 */
async function uploadOne(
  { file, destination }: QueueItem,
  callbacks: UploadCallbacks,
): Promise<string | null> {
  const body = new FormData();
  body.append("files", file);
  if (destination?.kind === "board") body.append("boardId", destination.id);
  if (destination?.kind === "tag") body.append("tag", destination.name);

  const name = file.name || "file";

  // The server enforces both caps itself; checking here as well spares the
  // Owner watching 95 MB go up only to be told it was too large.
  if (file.type.startsWith("video/") && file.size > MAX_VIDEO_BYTES) {
    return `${name}: That video is larger than 95 MB.`;
  }
  if (file.type.startsWith("image/") && file.size > MAX_IMAGE_BYTES) {
    return `${name}: That image is larger than 50 MB.`;
  }

  try {
    const response = await post(body, file.size, callbacks);
    // A reverse proxy in front of the instance refused the body before the app
    // ever saw it — Cloudflare over 100 MB, or nginx's client_max_body_size.
    if (response.status === 413) {
      return `${name}: that file is larger than your server's proxy allows — see the README on upload limits.`;
    }
    if (response.status < 200 || response.status >= 300) {
      return `${name}: the server returned ${response.status}.`;
    }

    const result = JSON.parse(response.text) as UploadResult;
    if (result.errors.length > 0) return result.errors[0];
    return result.uploaded === 1 ? null : `${name}: it wasn't saved.`;
  } catch {
    return `${name}: couldn't reach the server.`;
  }
}

/**
 * Owns every manual import in the app.
 *
 * Progress is measured in bytes sent, across the whole queue. It used to count
 * finished files instead, on the reasoning that bytes reach a self-hosted
 * instance almost at once and the wait is the server's processing. Video broke
 * that: 95 MB over a home uplink to a remote instance is most of a minute in
 * transit, and a second or less to process. What's left between the last byte
 * and the answer is shown separately, as processing.
 *
 * One request per file rather than one for the batch, so a failure names its
 * file and the rest carry on.
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

        // Progress arrives as a running total for this file; the queue's sum
        // moves by the difference.
        let counted = 0;
        let sent = false;
        const error = await uploadOne(item, {
          onProgress: (bytes) => {
            const delta = bytes - counted;
            counted = bytes;
            if (delta > 0) setState((prev) => ({ ...prev, sentBytes: prev.sentBytes + delta }));
          },
          onSent: () => {
            sent = true;
            setState((prev) => ({ ...prev, processing: prev.processing + 1 }));
          },
        });

        const rest = item.file.size - counted;
        setState((prev) => ({
          ...prev,
          completed: prev.completed + 1,
          failed: error ? prev.failed + 1 : prev.failed,
          errors: error ? [...prev.errors, error] : prev.errors,
          sentBytes: prev.sentBytes + rest,
          processing: sent ? prev.processing - 1 : prev.processing,
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

      const bytes = files.reduce((sum, file) => sum + file.size, 0);
      setState((prev) =>
        prev.running
          ? { ...prev, total: prev.total + files.length, totalBytes: prev.totalBytes + bytes }
          : { ...IDLE, running: true, total: files.length, totalBytes: bytes },
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
