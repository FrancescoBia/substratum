import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import { open, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { MAX_VIDEO_BYTES } from "@repo/shared";
import busboy from "busboy";
import { uploadsTmpDir } from "./config.server";
import { SNIFF_BYTES } from "./media-sniff";

/** One uploaded file, spooled to disk and not yet looked at. */
export type SpooledFile = {
  /** The client's name for it — for messages only, never a path. */
  name: string;
  path: string;
  /**
   * Bytes written. A file over the upload cap is cut off one byte past it —
   * the rest is read and thrown away, so the response can still say why rather
   * than the connection being cut — and its size alone then says it's too large.
   */
  size: number;
};

export type ReceivedUpload = { fields: Map<string, string>; files: SpooledFile[] };

/**
 * Reads a multipart upload, writing each file to its own temp file as it
 * arrives rather than holding it in memory — `request.formData()` buffers every
 * byte of every file, which at 95 MB a video is how a small instance runs out
 * of memory.
 *
 * Every file is spooled the same way whatever it is: which path it takes
 * through ingest is decided afterwards, from its bytes. The caller owns the
 * spooled files and must remove them with {@link discardSpooled}, whether or
 * not this resolves — on failure the ones written so far are removed here.
 */
export async function receiveUpload(request: Request): Promise<ReceivedUpload> {
  if (!request.body) throw new UploadUnreadable("The upload was empty.");

  let parser: busboy.Busboy;
  try {
    parser = busboy({
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      limits: {
        // One byte past the cap is enough to know a file is over it.
        fileSize: MAX_VIDEO_BYTES + 1,
        files: 20,
        fields: 10,
        fieldSize: 64 * 1024,
      },
    });
  } catch (error) {
    throw new UploadUnreadable("That upload isn't multipart form data.", { cause: error });
  }

  const fields = new Map<string, string>();
  const files: SpooledFile[] = [];
  const writes: Array<Promise<void>> = [];

  parser.on("field", (name, value) => fields.set(name, value));

  parser.on("file", (field, stream, info) => {
    if (field !== "files") {
      stream.resume();
      return;
    }

    // Named here, never from the client's filename.
    const file: SpooledFile = { name: info.filename || "file", path: spoolPath(), size: 0 };
    files.push(file);

    const out = createWriteStream(file.path);
    writes.push(pipeline(stream, out).then(() => void (file.size = out.bytesWritten)));
  });

  try {
    await pipeline(Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>), parser);
    await Promise.all(writes);
  } catch (error) {
    // Let any write still in flight settle before removing its file, or the
    // remove can land first and the write recreate it.
    await Promise.allSettled(writes);
    await discardSpooled(files);
    throw new UploadUnreadable("The upload was interrupted or malformed.", { cause: error });
  }

  return { fields, files };
}

/**
 * A fresh path in the spool directory, for a file on its way into ingest — an
 * upload's, or a capture's download. Whoever takes one removes it.
 */
export function spoolPath(): string {
  return join(uploadsTmpDir, `${randomUUID()}.upload`);
}

/** Removes spooled files, including any that ingest has already moved away. */
export async function discardSpooled(files: SpooledFile[]): Promise<void> {
  await Promise.all(files.map((file) => rm(file.path, { force: true })));
}

/** The first bytes of a spooled file — what `sniffMedia` reads. */
export async function readHead(path: string): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(head, 0, SNIFF_BYTES, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** The request couldn't be read as an upload at all. */
export class UploadUnreadable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UploadUnreadable";
  }
}

/**
 * Spooled files outlive their request only when the process doesn't — a crash
 * or a restart mid-upload. Anything left from then is swept when this module
 * loads; an hour's grace keeps it clear of an upload in flight in another
 * process sharing the volume.
 */
const STALE_AFTER_MS = 60 * 60 * 1000;

mkdirSync(uploadsTmpDir, { recursive: true });

void (async () => {
  try {
    const now = Date.now();
    for (const name of await readdir(uploadsTmpDir)) {
      const path = join(uploadsTmpDir, name);
      const { mtimeMs } = await stat(path);
      if (now - mtimeMs > STALE_AFTER_MS) await rm(path, { force: true });
    }
  } catch (error) {
    console.error("[upload] could not sweep stale spooled files:", error);
  }
})();
