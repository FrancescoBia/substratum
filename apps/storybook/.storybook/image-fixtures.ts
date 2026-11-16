import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures", import.meta.url));

/** The variants `img.$id.$variant.ts` serves. */
const VARIANTS = ["thumb", "medium", "original"];

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** Fixture id (the file name without its extension) → file name. */
function fixtures() {
  const byId = new Map<string, string>();
  for (const file of readdirSync(FIXTURES_DIR)) {
    const ext = extname(file).toLowerCase();
    if (CONTENT_TYPES[ext]) byId.set(file.slice(0, -ext.length), file);
  }
  return byId;
}

/**
 * Stands in for web's `/img/<id>/<variant>` route, so its components can be
 * given an id and load real bytes. `fixtures/landscape.jpg` answers for
 * `/img/landscape/<any variant>`: the variants differ only in size in the app,
 * and nothing in Storybook depends on that.
 *
 * The files keep their extensions so they open like any other image; the URLs
 * the components build have none, which is what this maps between.
 */
export function imageFixtures(): Plugin {
  return {
    name: "substratum:image-fixtures",

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = req.url?.match(/^\/img\/([^/?#]+)\/([^/?#]+)/);
        if (!match || !VARIANTS.includes(match[2])) return next();
        const file = fixtures().get(decodeURIComponent(match[1]));
        if (!file) return next();
        res.setHeader("Content-Type", CONTENT_TYPES[extname(file).toLowerCase()]);
        res.end(readFileSync(join(FIXTURES_DIR, file)));
      });
    },

    // The static build has no server, so write a copy at each path instead.
    generateBundle() {
      for (const [id, file] of fixtures()) {
        const source = readFileSync(join(FIXTURES_DIR, file));
        for (const variant of VARIANTS) {
          this.emitFile({ type: "asset", fileName: `img/${id}/${variant}`, source });
        }
      }
    },
  };
}
