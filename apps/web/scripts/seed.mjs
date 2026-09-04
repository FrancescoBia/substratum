/**
 * Fills a running instance with sample images and boards, so a reviewer gets
 * from clone to something worth looking at in one command.
 *
 *   pnpm dev            # in one terminal
 *   pnpm seed           # in another
 *
 * Defaults to http://localhost:3000. On any other port, say so — the seeder has
 * no way to discover where the dev server bound:
 *
 *   pnpm seed --url http://localhost:4000
 *
 * On a fresh instance it creates the Owner and prints the generated password.
 * On an existing one it needs credentials — it will never guess:
 *
 *   SUBSTRATUM_SEED_EMAIL=you@example.com SUBSTRATUM_SEED_PASSWORD=… pnpm seed
 *
 * It only ever adds; nothing is deleted or overwritten.
 */
import { randomBytes } from "node:crypto";
import sharp from "sharp";

/** `--url` beats the env var, which beats the local-development default. */
function resolveBase() {
  const raw = flagValue("--url") ?? process.env.SUBSTRATUM_URL ?? "http://localhost:3000";
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`Not a URL: ${JSON.stringify(raw)}`);
  }
}

function flagValue(name) {
  const args = process.argv.slice(2);
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);

  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/** Assigned by the entry point below, so a malformed target reports cleanly. */
let BASE;

let cookie = "";

async function call(path, { form, multipart } = {}) {
  const headers = cookie ? { cookie } : {};
  let body;

  if (form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form);
  } else if (multipart) {
    body = multipart;
  }

  const response = await fetch(BASE + path, {
    method: form || multipart ? "POST" : "GET",
    headers,
    body,
    redirect: "manual",
  });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie?.includes("session=") && !setCookie.includes("session=;")) {
    cookie = setCookie.split(";")[0];
  }

  return response;
}

/**
 * Refuse to touch anything that hasn't identified itself as Substratum.
 *
 * Seeding creates an account and uploads files to whatever answers, so a wrong
 * port is not a harmless mistake — it hands a generated password to a stranger's
 * app. `/api/session` is the cheapest thing only this app serves, and it needs
 * no session of its own, so this costs one request before anything is written.
 */
async function confirmSubstratum() {
  const usage = "  pnpm seed --url http://localhost:<port>";

  let response;
  try {
    response = await call("/api/session");
  } catch (cause) {
    throw new Error(
      `Nothing answered at ${BASE}.\nStart the app first, or point the seeder at it:\n${usage}`,
      { cause },
    );
  }

  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not JSON at all, which the check below reports along with everything else.
  }

  if (!response.ok || typeof parsed?.authenticated !== "boolean") {
    throw new Error(
      `${BASE} answered, but it is not a Substratum instance: ` +
        `GET /api/session returned ${response.status} ${describeBody(body)}.\n` +
        `Nothing was written. Point the seeder at the right address:\n${usage}`,
    );
  }
}

function describeBody(body) {
  const snippet = body.replace(/\s+/g, " ").trim();
  if (!snippet) return "with an empty body";
  return `— "${snippet.slice(0, 80)}${snippet.length > 80 ? "…" : ""}"`;
}

async function authenticated() {
  const response = await call("/api/session");
  const body = await response.json();
  return body.authenticated === true;
}

async function signIn() {
  const email = process.env.SUBSTRATUM_SEED_EMAIL;
  const password = process.env.SUBSTRATUM_SEED_PASSWORD;

  if (email && password) {
    await call("/login", { form: { email, password } });
    if (!(await authenticated())) throw new Error("Those credentials were rejected.");
    console.log(`Signed in as ${email}.`);
    return;
  }

  // No credentials given — only a brand-new instance can be seeded.
  const generated = `dev-${randomBytes(6).toString("hex")}`;
  const devEmail = "dev@example.invalid";
  await call("/setup", {
    form: { email: devEmail, password: generated, confirm: generated },
  });

  if (!(await authenticated())) {
    throw new Error(
      "This instance already has an owner. Re-run with SUBSTRATUM_SEED_EMAIL and " +
        "SUBSTRATUM_SEED_PASSWORD set to seed it.",
    );
  }

  console.log(`Created the owner account:\n  email:    ${devEmail}\n  password: ${generated}\n`);
}

const PALETTE = [
  [214, 69, 65],
  [48, 110, 180],
  [240, 196, 74],
  [76, 164, 109],
  [150, 96, 190],
  [230, 130, 60],
  [60, 180, 190],
  [200, 80, 140],
];

async function upload(index) {
  const [r, g, b] = PALETTE[index % PALETTE.length];
  const buffer = await sharp({
    create: {
      width: 600 + (index % 3) * 140,
      height: 500 + (index % 4) * 160,
      channels: 3,
      background: { r, g, b },
    },
  })
    .png()
    .toBuffer();

  const body = new FormData();
  body.append("files", new Blob([buffer], { type: "image/png" }), `sample-${index}.png`);
  const response = await call("/upload", { multipart: body });
  if (!response.ok) throw new Error(`upload ${index} failed: ${response.status}`);
}

try {
  BASE = resolveBase();
  await main();
} catch (error) {
  // Every throw above is a configuration mistake — wrong port, wrong
  // credentials, app not running. The message is the whole point of those, and
  // a stack trace buries it.
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
}

async function main() {
  await confirmSubstratum();
  await signIn();

  const count = Number(process.env.SUBSTRATUM_SEED_COUNT ?? 12);
  for (let index = 0; index < count; index++) await upload(index);
  console.log(`Uploaded ${count} sample images.`);

  for (const name of ["Dark UI", "Typography", "Layout"]) {
    const response = await call("/boards", { form: { intent: "create", name } });
    const body = await response.json();
    if (body.ok) console.log(`Created board "${name}".`);
  }

  console.log(`\nDone — open ${BASE}`);
}
