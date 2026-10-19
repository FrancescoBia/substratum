/**
 * Checks that the configured bucket can do everything the app asks of it,
 * before anything depends on it.
 *
 *   pnpm check:bucket
 *   docker compose exec -e S3_BUCKET=… … app node ./scripts/check-bucket.mjs
 *
 * Startup only checks that the variables are present and well-formed. Whether
 * the credentials work, the region is right and the bucket exists only shows up
 * at the first upload — or, worse, the first image someone views. This finds
 * out in a few seconds, with the app's own client, so a pass here means the app
 * will get the same answers.
 *
 * Everything it writes goes under __substratum_selftest__/<random>/ and is
 * deleted at the end, so it is safe against a bucket already holding a library.
 */
import { randomUUID } from "node:crypto";
import { s3Config } from "../app/lib/config.server.ts";
import { deleteObjects, getObject, listObjectKeys, putObject } from "../app/lib/s3.server.ts";

if (!s3Config) {
  console.error(
    "No bucket is configured. Set S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID and\n" +
      "S3_SECRET_ACCESS_KEY, then run this again.",
  );
  process.exit(1);
}

const base = `__substratum_selftest__/${randomUUID().slice(0, 8)}`;

console.log("Checking bucket access");
console.log(`  bucket      ${s3Config.bucket}`);
console.log(`  endpoint    ${s3Config.endpoint}`);
console.log(`  region      ${s3Config.region}`);
console.log(`  addressing  ${s3Config.forcePathStyle ? "path-style" : "virtual-hosted"}`);
console.log(`  prefix      ${s3Config.prefix || "(none)"}\n`);

let failed = 0;

async function check(name, body) {
  const started = Date.now();
  try {
    await body();
    console.log(`  ok    ${name} (${Date.now() - started}ms)`);
  } catch (error) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error?.code ? `[${error.code}] ` : ""}${error?.message ?? error}`);
  }
}

// A byte pattern that survives nothing but an exact round trip.
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d, 0x0a, 0x1a, 0x0a]);
const plainKey = `${base}/original.png`;
// Non-ASCII and characters the signature encodes differently from a URL.
const awkwardKey = `${base}/ünïcode dir/a+b (1)'2'.webp`;

await check("write an object", () => putObject(s3Config, plainKey, bytes));

await check("read it back byte-for-byte", async () => {
  const got = await getObject(s3Config, plainKey);
  if (!got.equals(bytes)) throw new Error(`got ${got.length} bytes, expected ${bytes.length}`);
});

await check("write and read a key needing escapes", async () => {
  await putObject(s3Config, awkwardKey, bytes);
  const got = await getObject(s3Config, awkwardKey);
  if (!got.equals(bytes)) throw new Error("bytes differ — check request signing");
});

await check("list the prefix and see both keys", async () => {
  const keys = await listObjectKeys(s3Config, `${base}/`);
  const missing = [plainKey, awkwardKey].filter((key) => !keys.includes(key));
  if (missing.length > 0) throw new Error(`listing missed: ${missing.join(", ")}`);
});

// The app tells a missing image (404) from a bucket it can't reach (503) by
// this status, so anything other than 404 here means missing images would be
// reported as an outage.
await check("a missing key reports 404", async () => {
  const error = await getObject(s3Config, `${base}/does-not-exist.png`).then(
    () => null,
    (e) => e,
  );
  if (!error) throw new Error("reading a missing key succeeded");
  if (error.status !== 404) throw new Error(`expected 404, got ${error.status} (${error.code})`);
});

await check("delete the prefix and leave nothing behind", async () => {
  const keys = await listObjectKeys(s3Config, `${base}/`);
  if (keys.length > 0) await deleteObjects(s3Config, keys);
  const left = await listObjectKeys(s3Config, `${base}/`);
  if (left.length > 0) throw new Error(`${left.length} key(s) survived: ${left.join(", ")}`);
});

if (failed === 0) {
  console.log("\nAll good — this bucket can back the app.");
} else {
  console.log(
    `\n${failed} check(s) failed. "Troubleshooting a bucket" in the README covers the usual causes.`,
  );
  process.exitCode = 1;
}
