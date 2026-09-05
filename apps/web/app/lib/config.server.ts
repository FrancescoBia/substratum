import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { S3Config } from "./s3.server";

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

/**
 * S3-compatible object storage — R2, B2, MinIO. Off unless
 * SUBSTRATUM_S3_BUCKET names a bucket, so an instance that configures nothing
 * keeps its images on local disk in the data volume exactly as before.
 *
 * A half-configured bucket throws rather than falling back: quietly writing to
 * local disk because one variable was misspelled is how an operator ends up
 * with images split across two backends and nothing anywhere saying so.
 */
export const s3Config: S3Config | null = loadS3Config();

function loadS3Config(): S3Config | null {
  const bucket = process.env.SUBSTRATUM_S3_BUCKET?.trim();
  if (!bucket) return null;

  const endpoint = requiredEnv("SUBSTRATUM_S3_ENDPOINT").replace(/\/+$/, "");
  try {
    new URL(endpoint);
  } catch {
    throw new Error(`SUBSTRATUM_S3_ENDPOINT must be a URL, got ${JSON.stringify(endpoint)}`);
  }

  // A prefix is always a directory-ish thing, so it is normalised here rather
  // than leaving every caller to guess whose job the slash is.
  const prefix = process.env.SUBSTRATUM_S3_PREFIX?.replace(/^\/+|\/+$/g, "") ?? "";

  return {
    bucket,
    endpoint,
    // R2 wants "auto"; MinIO and most others are content with us-east-1.
    region: process.env.SUBSTRATUM_S3_REGION?.trim() || "us-east-1",
    accessKeyId: requiredEnv("SUBSTRATUM_S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("SUBSTRATUM_S3_SECRET_ACCESS_KEY"),
    // Path-style addressing is what R2, B2 and MinIO all accept. AWS S3 proper
    // dropped it for buckets created after 2020, which is what turning this off
    // is for.
    forcePathStyle: booleanFromEnv("SUBSTRATUM_S3_FORCE_PATH_STYLE", true),
    prefix: prefix ? `${prefix}/` : "",
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when SUBSTRATUM_S3_BUCKET is set.`);
  return value;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`${name} must be true or false, got ${JSON.stringify(raw)}`);
}

mkdirSync(dataDir, { recursive: true });
// With a bucket configured there is no local images directory to create.
if (!s3Config) mkdirSync(imagesDir, { recursive: true });

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
