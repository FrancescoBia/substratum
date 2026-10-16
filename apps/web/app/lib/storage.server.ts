import { createReadStream, mkdirSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { formatRange, resolveRange, type ByteRange, type ResolvedRange } from "./byte-range";
import { imagesDir, s3Config } from "./config.server";
import {
  deleteObjects,
  getObject,
  headObject,
  listObjectKeys,
  openObject,
  putObject,
  S3Error,
  type S3Config,
} from "./s3.server";

/**
 * Everything that touches stored bytes goes through this interface, so the
 * S3-compatible backend is a second implementation rather than a hunt through
 * the codebase. Local disk stays the default because it needs no
 * configuration: the images sit in the same volume as the database.
 */
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  /** Throws {@link StorageNotFound} when the key holds nothing. */
  get(key: string): Promise<Buffer>;
  /**
   * Streams the object, or the one range of it asked for, without holding it in
   * memory — what serving an original needs, since a video is played by asking
   * for pieces of it. Throws {@link StorageNotFound} like `get`, and
   * {@link RangeNotSatisfiable} when no part of the object is in `range`.
   *
   * The caller owns the body and must read it to the end or cancel it.
   */
  open(key: string, range?: ByteRange): Promise<OpenedObject>;
  /** Removes the whole prefix — an Image's original and all its derivatives. */
  deletePrefix(prefix: string): Promise<void>;
}

/**
 * The key holds nothing — as distinct from the backend being unable to say.
 *
 * On local disk those two were effectively one: the only way a read failed was
 * ENOENT, so callers could treat any failure as "gone" and be right. A bucket
 * breaks that. Bad credentials, a throttle that outlives the retries, DNS that
 * stopped resolving — all of them are a backend that cannot answer *right now*,
 * and reporting them as a missing image tells the Owner their library was
 * deleted. Every caller that distinguishes the two branches on this.
 */
export class StorageNotFound extends Error {
  constructor(key: string, options?: { cause?: unknown }) {
    super(`No stored object for ${key}`, options);
    this.name = "StorageNotFound";
  }
}

/**
 * A body on its way out of storage. `range` is null when the body is the whole
 * object — including when a range was asked for and the backend chose to send
 * everything, which HTTP allows and the caller must then honour.
 */
export type OpenedObject = {
  body: ReadableStream<Uint8Array>;
  size: number;
  range: ResolvedRange | null;
};

/** The object exists, but the range asked for lies wholly past its end. */
export class RangeNotSatisfiable extends Error {
  /** Reported back in the 416's `Content-Range`, so the client can ask again. */
  readonly size: number;

  constructor(key: string, size: number) {
    super(`No bytes of ${key} (${size} long) are in the requested range`);
    this.name = "RangeNotSatisfiable";
    this.size = size;
  }
}

class LocalStorage implements Storage {
  constructor() {
    // The directory is this backend's own precondition, so this backend makes
    // it. Leaving it to config.server meant that module had to know which
    // implementation was in play before it could decide whether to bother.
    mkdirSync(imagesDir, { recursive: true });
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = join(imagesDir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(join(imagesDir, key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StorageNotFound(key, { cause: error });
      }
      throw error;
    }
  }

  async open(key: string, range?: ByteRange): Promise<OpenedObject> {
    const path = join(imagesDir, key);

    let size: number;
    try {
      size = (await stat(path)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StorageNotFound(key, { cause: error });
      }
      throw error;
    }

    const resolved = range ? resolveRange(range, size) : null;
    if (range && !resolved) throw new RangeNotSatisfiable(key, size);

    const stream = createReadStream(path, resolved ?? undefined);
    return {
      body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
      size,
      range: resolved,
    };
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(join(imagesDir, prefix), { recursive: true, force: true });
  }
}

/**
 * The same contract against an S3-compatible bucket — R2, B2, MinIO. Bytes are
 * still read and written through the app rather than served from the bucket
 * directly, because `/img/:id/:variant` is where the published-board visibility
 * check lives and handing out bucket URLs would route around it.
 */
class S3Storage implements Storage {
  private readonly config: S3Config;

  constructor(config: S3Config) {
    this.config = config;
  }

  put(key: string, data: Buffer): Promise<void> {
    return putObject(this.config, key, data);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await getObject(this.config, key);
    } catch (error) {
      // 404 is the bucket answering clearly; anything else is it failing to.
      if (error instanceof S3Error && error.status === 404) {
        throw new StorageNotFound(key, { cause: error });
      }
      throw error;
    }
  }

  async open(key: string, range?: ByteRange): Promise<OpenedObject> {
    try {
      return await openObject(this.config, key, range ? formatRange(range) : undefined);
    } catch (error) {
      if (error instanceof S3Error && error.status === 404) {
        throw new StorageNotFound(key, { cause: error });
      }
      // A 416 does not reliably say how large the object is, and the client
      // needs that to ask again — so this rare path pays for one more request.
      if (error instanceof S3Error && error.status === 416) {
        const { size } = await headObject(this.config, key);
        throw new RangeNotSatisfiable(key, size);
      }
      throw error;
    }
  }

  /**
   * S3 has no directories, so the local `rm -r` becomes list-by-prefix and then
   * batch delete. The trailing slash matters: it keeps a listing to the keys
   * *under* this Image's id rather than every key merely starting with it.
   */
  async deletePrefix(prefix: string): Promise<void> {
    const keys = await listObjectKeys(this.config, prefix.endsWith("/") ? prefix : `${prefix}/`);
    if (keys.length > 0) await deleteObjects(this.config, keys);
  }
}

export const storage: Storage = s3Config ? new S3Storage(s3Config) : new LocalStorage();

/** Derivatives live beside the original under the Image's id. */
export const storageKeys = {
  original: (id: string, extension: string) => `${id}/original.${extension}`,
  thumb: (id: string) => `${id}/thumb.webp`,
  medium: (id: string) => `${id}/medium.webp`,
  prefix: (id: string) => id,
};

export type Variant = "thumb" | "medium" | "original";
