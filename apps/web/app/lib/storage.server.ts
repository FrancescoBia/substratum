import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { imagesDir, s3Config } from "./config.server";
import { deleteObjects, getObject, listObjectKeys, putObject, type S3Config } from "./s3.server";

/**
 * Everything that touches stored bytes goes through this interface, so the
 * S3-compatible backend is a second implementation rather than a hunt through
 * the codebase. Local disk stays the default because it needs no
 * configuration: the images sit in the same volume as the database.
 */
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Removes the whole prefix — an Image's original and all its derivatives. */
  deletePrefix(prefix: string): Promise<void>;
}

class LocalStorage implements Storage {
  async put(key: string, data: Buffer): Promise<void> {
    const path = join(imagesDir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  get(key: string): Promise<Buffer> {
    return readFile(join(imagesDir, key));
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

  get(key: string): Promise<Buffer> {
    return getObject(this.config, key);
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
