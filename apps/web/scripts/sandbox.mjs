/**
 * A disposable dev instance with known credentials and a seeded library, for
 * clicking around (or letting an agent click around) without the login getting
 * in the way and without touching the real dev data in ./data.
 *
 *   pnpm dev:sandbox          # http://localhost:5174, wiped and reseeded
 *   pnpm dev:sandbox --keep   # reuse the existing sandbox library as it is
 *
 * It runs the ordinary dev server — the app has no dev-only login route — on its
 * own port and data directory, then signs up through the real /setup endpoint.
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/** Test values for this throwaway instance only. */
const EMAIL = "sandbox@substratum.test";
const PASSWORD = "sandbox-password";
const PORT = 5174;
const BASE = `http://localhost:${PORT}`;

// Deliberately hard-coded, like reset-test-data.mjs: never pointable at real data.
const dataDir = resolve(process.cwd(), ".sandbox-data");
if (!dataDir.endsWith(".sandbox-data")) throw new Error(`refusing to use ${dataDir}`);

const keep = process.argv.includes("--keep") && existsSync(dataDir);
if (!keep) rmSync(dataDir, { recursive: true, force: true });

const server = spawn(
  "pnpm",
  ["exec", "react-router", "dev", "--port", String(PORT), "--strictPort"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      SUBSTRATUM_DATA_DIR: dataDir,
      // Same isolation as the e2e server: no developer .env, never a bucket.
      SUBSTRATUM_SKIP_ENV_FILE: "1",
      S3_BUCKET: "",
    },
  },
);

const stop = () => server.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
let seedFailed = false;
server.on("exit", (code) => process.exit(seedFailed ? 1 : (code ?? 0)));

await waitForServer();

if (!keep) {
  const seed = spawn("node", ["./scripts/seed.mjs", "--url", BASE], {
    stdio: "inherit",
    env: { ...process.env, SUBSTRATUM_SEED_EMAIL: EMAIL, SUBSTRATUM_SEED_PASSWORD: PASSWORD },
  });
  const code = await new Promise((done) => seed.on("exit", done));
  if (code !== 0) {
    console.error("\nSeeding failed, so the sandbox was stopped.");
    seedFailed = true;
    stop();
  }
}

if (!seedFailed)
  console.log(`\nSandbox ready at ${BASE}\n  email:    ${EMAIL}\n  password: ${PASSWORD}\n`);

async function waitForServer() {
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      const response = await fetch(`${BASE}/api/session`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  stop();
  throw new Error(`The sandbox server never answered at ${BASE}.`);
}
