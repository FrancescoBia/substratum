import { mkdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { imagesDir, s3Config } from "./config.server";
import {
  deleteObjects,
  getObject,
  listObjectKeys,
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
