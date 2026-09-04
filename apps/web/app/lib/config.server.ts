import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * All configuration is environment variables with working defaults, so a
 * self-hoster needs no config file. In Docker, SUBSTRATUM_DATA_DIR is
 * /data — the single volume holding the database and the images.
 */
export const dataDir = resolve(process.env.SUBSTRATUM_DATA_DIR ?? "./data");
export const dbPath = join(dataDir, "library.db");
export const imagesDir = join(dataDir, "images");

/**
 * Public origin of this instance: published board links, canonical URLs and OG
 * tags are all built from it.
 *
 * SUBSTRATUM_URL pins it, and anything reachable from outside should set it. It
 * is the only answer that survives a reverse proxy, and the only one a visitor
 * cannot influence.
 *
 * Left unset, the origin is read off the request instead — see `instanceUrlFor`.
 * The old fallback guessed `localhost:3000`, which was wrong for every dev
 * server on another port and quietly handed out links to whatever else was
 * listening there.
 */
const configuredUrl = process.env.SUBSTRATUM_URL?.replace(/\/+$/, "") ?? null;

/**
 * The origin to build outward-facing links from, for one request.
 *
 * Without SUBSTRATUM_URL this is a considered guess, not a trusted value: the
 * headers it reads are visitor-controlled when the app is exposed directly. That
 * is tolerable because the result is only ever used to build links back to this
 * instance, and it is exactly why the env var exists.
 */
export function instanceUrlFor(request: Request): string {
  if (configuredUrl) return configuredUrl;

  const url = new URL(request.url);

  // A TLS-terminating proxy leaves the app speaking plain HTTP on an internal
  // address, so where it says what it forwarded, that beats what we can see.
  const protocol = firstHeaderValue(request, "X-Forwarded-Proto") ?? url.protocol.slice(0, -1);
  const host = firstHeaderValue(request, "X-Forwarded-Host") ?? url.host;
  if (protocol !== "http" && protocol !== "https") return url.origin;

  try {
    // Parsing before returning is the guard: `origin` normalises the pair and
    // rejects anything that is not a plain scheme and authority.
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return url.origin;
  }
}

/** Forwarded headers accumulate a comma-separated list; the client's is first. */
function firstHeaderValue(request: Request, name: string): string | null {
  const raw = request.headers.get(name);
  if (!raw) return null;
  return raw.split(",")[0].trim() || null;
}

/**
 * Pin the published extension's ID here (via env) once it exists, so only that
 * extension may call the capture API. Until then any chrome-extension origin is
 * accepted, which is fine for local development but should not ship as-is.
 */
export const extensionId = process.env.SUBSTRATUM_EXTENSION_ID ?? null;

/** How long a trashed Image stays recoverable before it is purged for good. */
export const trashRetentionDays = numberFromEnv("SUBSTRATUM_TRASH_RETENTION_DAYS", 30);

/** How often the purge sweep runs. Lowered in tests so the sweep is observable. */
export const trashPurgeIntervalMs = numberFromEnv(
  "SUBSTRATUM_TRASH_PURGE_INTERVAL_MS",
  6 * 60 * 60 * 1000,
);

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, got ${JSON.stringify(raw)}`);
  }
  return value;
}

mkdirSync(dataDir, { recursive: true });
mkdirSync(imagesDir, { recursive: true });

/**
 * Cookie signing secret. Generated into the data directory on first run rather
 * than demanded from the operator — one less thing to configure, and it
 * survives restarts because it lives in the volume.
 */
function loadOrCreateSecret(): string {
  if (process.env.SUBSTRATUM_SECRET) return process.env.SUBSTRATUM_SECRET;

  const secretPath = join(dataDir, "secret.key");
  if (existsSync(secretPath)) return readFileSync(secretPath, "utf8").trim();

  const secret = randomBytes(32).toString("hex");
  writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

export const cookieSecret = loadOrCreateSecret();
