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
 * Two passes, so nothing saved during the copy is left behind:
 *
 *   1. Run it while the app is still up and serving from the source. This is
 *      the long one, and nothing is down while it runs.
 *   2. Stop the app, run it again, then flip the environment variables and
 *      start the app. Anything saved during the first pass is copied now.
 *
 * The second pass is quick because only keys missing at the target are
 * copied. Stored bytes never change for a given key — every key is under a
 * fresh Image id — so a key already at the target already holds the right
 * bytes. That is only true if a write is all-or-nothing: a bucket PUT is, and
 * a file on disk is made so by writing it elsewhere and renaming it into place.
 *
 * Nothing at the source is deleted or altered, so the old copies stay as a
 * safety net until the operator clears them by hand, and an interrupted run is
 * finished by running it again.
 *
 * Keys are taken from the source rather than rebuilt from the database, so
 * whatever is actually stored is what gets copied, and the layout can change
 * without this script needing to know.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { dataDir, imagesDir, s3Config } from "../app/lib/config.server.ts";
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

/**
 * Where files bound for disk are written before being renamed into place.
 * Beside the images directory rather than inside it, so a run interrupted
 * mid-write leaves nothing a later disk-to-bucket copy would mistake for an
 * image; in the same volume, so the rename is atomic.
 */
const partialDir = join(dataDir, ".migrate-partial");

const [sourceKeys, targetKeys] = await Promise.all(
  toDisk
    ? [listObjectKeys(s3Config, ""), localKeys(imagesDir)]
    : [localKeys(imagesDir), listObjectKeys(s3Config, "")],
);
const alreadyThere = new Set(targetKeys);
const keys = sourceKeys.filter((key) => !alreadyThere.has(key));
const skipped = sourceKeys.length - keys.length;

const source = toDisk ? `bucket ${bucket}` : imagesDir;
const target = toDisk ? imagesDir : `bucket ${bucket}`;

let partials = 0;
const copy = toDisk
  ? async (key) => {
      const path = localPathFor(key);
      const partial = join(partialDir, String(partials++));
      await writeFile(partial, await getObject(s3Config, key));
      await mkdir(dirname(path), { recursive: true });
      await rename(partial, path);
    }
  : async (key) => putObject(s3Config, key, await readFile(join(imagesDir, key)));

if (sourceKeys.length === 0) {
  console.log(`Nothing to copy — ${source} holds no stored images.`);
  process.exit(0);
}

/** The last step, once the target holds everything. */
const switchOver = toDisk
  ? "unset the SUBSTRATUM_S3_* variables and start the app to serve from disk."
  : "set the SUBSTRATUM_S3_* variables and start the app to serve from the bucket.";

if (keys.length === 0) {
  console.log(`Nothing to copy — all ${sourceKeys.length} file(s) are already in ${target}.`);
  console.log(`\nIf the app is stopped, ${switchOver}`);
  process.exit(0);
}

console.log(`Copying ${keys.length} file(s)`);
console.log(`  from  ${source}`);
console.log(`  to    ${target}`);
if (skipped > 0) console.log(`Skipping ${skipped} already there.`);
console.log("Nothing at the source is deleted or changed.\n");

if (!assumeYes && !(await confirm("Continue?"))) {
  // Deciding not to is a fine outcome, not a failure — exiting non-zero here
  // makes the package manager report a deliberate answer as a crash.
  console.log("Cancelled. Nothing was copied.");
  process.exit(0);
}

if (toDisk) {
  // Anything here is left over from an interrupted run and was never renamed
  // into place, so it is safe to clear.
  await rm(partialDir, { recursive: true, force: true });
  await mkdir(partialDir, { recursive: true });
}

const failures = await copyAll(keys, copy);
if (toDisk) await rm(partialDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${keys.length} could not be copied:`);
  for (const { item, error } of failures.slice(0, 10)) {
    console.error(`  ${item}: ${error.message}`);
  }
  if (failures.length > 10) console.error(`  … and ${failures.length - 10} more`);
  console.error("\nRe-run to retry: only what is still missing is copied.");
  process.exit(1);
}

console.log(`\nCopied ${keys.length} file(s). ${source} is untouched.`);
// The script cannot tell whether the app is still running, so it says both.
console.log(
  "\nIf the app was running during this copy, anything saved meanwhile is not in it yet: " +
    "stop the app and run this again — it copies only what is missing.\n" +
    `If the app was stopped, ${switchOver}`,
);
