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
 * Public URL of this instance, used for published board links.
 *
 * The default covers local development, where the server binds the same port
 * you visit. Anything else — a published container port, a domain, a reverse
 * proxy — has to set SUBSTRATUM_URL, because the port this process binds tells us
 * nothing about the address people reach it on.
 */
export const instanceUrl =
  process.env.SUBSTRATUM_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

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
