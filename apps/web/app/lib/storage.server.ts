import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { imagesDir } from "./config.server";

/**
 * Everything that touches stored bytes goes through this interface, so adding
 * S3-compatible storage later is a second implementation rather than
 * a hunt through the codebase. Local disk is the default because it needs no
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

export const storage: Storage = new LocalStorage();

/** Derivatives live beside the original under the Image's id. */
export const storageKeys = {
  original: (id: string, extension: string) => `${id}/original.${extension}`,
  thumb: (id: string) => `${id}/thumb.webp`,
  medium: (id: string) => `${id}/medium.webp`,
  prefix: (id: string) => id,
};

export type Variant = "thumb" | "medium" | "original";
