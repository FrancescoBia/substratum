/**
 * Copies stored images between the local data directory and an S3-compatible
 * bucket, for moving an instance from one to the other.
 *
 *   pnpm migrate:storage             # local disk -> bucket
 *   pnpm migrate:storage --to-disk   # bucket -> local disk
 *
 * Switching backends is otherwise not a migration at all: the app simply starts
 * looking somewhere else, and every image saved before the switch 404s while
 * sitting untouched where it was. This closes that gap.
 *
 * Run it *before* flipping the environment variables, while the app is still
 * reading from the source, and there is no window in which anything is missing.
 *
 * Nothing at the source is deleted or altered, so the old copies stay as a
 * safety net until the operator clears them by hand. Re-running is safe —
 * every object is written with the same key and the same bytes — so an
 * interrupted run is finished by running it again.
 *
 * Keys are taken from the source rather than rebuilt from the database, so
 * whatever is actually stored is what gets copied, and the layout can change
 * without this script needing to know.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { imagesDir, s3Config } from "../app/lib/config.server.ts";
import { getObject, listObjectKeys, putObject } from "../app/lib/s3.server.ts";

/** How many objects to move at once — enough to hide latency, few enough that
 * only a handful of originals are held in memory at a time. */
const CONCURRENCY = 4;

const toDisk = process.argv.includes("--to-disk");
const assumeYes = process.argv.includes("--yes") || process.argv.includes("-y");

if (!s3Config) {
  console.error(
    "No bucket is configured, so there is nothing to copy to or from.\n" +
      "Set SUBSTRATUM_S3_BUCKET along with its endpoint and credentials, then run this again.",
  );
  process.exit(1);
}

/** Every file under the images directory, as adapter-relative keys. */
async function localKeys(root) {
  const keys = [];

  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      // An instance that has always used a bucket has no images directory.
      if (error.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) keys.push(relative(root, full).split(sep).join("/"));
    }
  }

  await walk(root);
  return keys;
}

/**
 * Where a bucket key lands on disk, refusing anything that would climb out of
 * the images directory. The operator owns the bucket, but a key is still data
 * arriving from elsewhere and it costs nothing to check.
 */
function localPathFor(key) {
  const path = join(imagesDir, key);
  const inside = relative(imagesDir, path);
  if (inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(`refusing to write outside the images directory: ${key}`);
  }
  return path;
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

/** Runs `work` over every item, a few at a time, collecting failures rather
 * than stopping — one unreadable file shouldn't abandon the rest. */
async function copyAll(items, work) {
  const failures = [];
  const tty = process.stdout.isTTY;
  let next = 0;
  let done = 0;

  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await work(item);
      } catch (error) {
        failures.push({ item, error });
      }
      done++;
      if (tty) process.stdout.write(`\r  ${done}/${items.length}`);
      else if (done % 100 === 0) console.log(`  ${done}/${items.length}`);
    }
  });

  await Promise.all(runners);
  if (tty) process.stdout.write("\n");
  return failures;
}

// The stored prefix always ends in "/"; trimmed here so the label reads cleanly.
const bucket = s3Config.prefix
  ? `${s3Config.bucket}/${s3Config.prefix.replace(/\/$/, "")}`
  : s3Config.bucket;

const keys = toDisk ? await listObjectKeys(s3Config, "") : await localKeys(imagesDir);
const source = toDisk ? `bucket ${bucket}` : imagesDir;
const target = toDisk ? imagesDir : `bucket ${bucket}`;

const copy = toDisk
  ? async (key) => {
      const path = localPathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, await getObject(s3Config, key));
    }
  : async (key) => putObject(s3Config, key, await readFile(join(imagesDir, key)));

if (keys.length === 0) {
  console.log(`Nothing to copy — ${source} holds no stored images.`);
  process.exit(0);
}

console.log(`Copying ${keys.length} file(s)`);
console.log(`  from  ${source}`);
console.log(`  to    ${target}`);
console.log("Nothing at the source is deleted or changed.\n");

if (!assumeYes && !(await confirm("Continue?"))) {
  // Deciding not to is a fine outcome, not a failure — exiting non-zero here
  // makes the package manager report a deliberate answer as a crash.
  console.log("Cancelled. Nothing was copied.");
  process.exit(0);
}

const failures = await copyAll(keys, copy);

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${keys.length} could not be copied:`);
  for (const { item, error } of failures.slice(0, 10)) {
    console.error(`  ${item}: ${error.message}`);
  }
  if (failures.length > 10) console.error(`  … and ${failures.length - 10} more`);
  console.error("\nRe-run to retry: copying the same file twice is harmless.");
  process.exit(1);
}

console.log(`\nCopied ${keys.length} file(s). ${source} is untouched.`);
console.log(
  toDisk
    ? "Unset the SUBSTRATUM_S3_* variables and restart to serve them from disk."
    : "Set the SUBSTRATUM_S3_* variables and restart to serve them from the bucket.",
);
