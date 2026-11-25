/**
 * Fills a running instance with sample images, videos and boards, so a reviewer
 * gets from clone to something worth looking at in one command. Needs ffmpeg,
 * like the app itself.
 *
 *   pnpm dev            # in one terminal
 *   pnpm seed           # in another
 *
 * Defaults to http://localhost:5173, where `pnpm dev` binds. On any other port,
 * say so — the seeder has no way to discover where the dev server bound:
 *
 *   pnpm seed --url http://localhost:4000
 *
 * On a fresh instance it creates the Owner — with SUBSTRATUM_SEED_EMAIL and
 * SUBSTRATUM_SEED_PASSWORD if set, otherwise with a generated password it
 * prints. On an existing one it needs those credentials — it will never guess:
 *
 *   SUBSTRATUM_SEED_EMAIL=you@example.com SUBSTRATUM_SEED_PASSWORD=… pnpm seed
 *
 * It only ever adds; nothing is deleted or overwritten.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

/** `--url` beats the env var, which beats the local-development default. */
function resolveBase() {
  const raw = flagValue("--url") ?? process.env.SUBSTRATUM_URL ?? "http://localhost:5173";
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
    // On a fresh instance this creates the Owner with exactly these
    // credentials; on one that already has an Owner, /setup refuses and the
    // sign-in below is what counts.
    await call("/setup", { form: { email, password, confirm: password } });
    if (!(await authenticated())) await call("/login", { form: { email, password } });
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
  ["#d64541", "#3b0d0c"],
  ["#306eb4", "#0b1d33"],
  ["#f0c44a", "#5a3d00"],
  ["#4ca46d", "#0f2e1b"],
  ["#9660be", "#25113a"],
  ["#e6823c", "#3d1a03"],
  ["#3cb4be", "#06292c"],
  ["#c8508c", "#360b20"],
];

/** Labelled gradients, so each sample is recognisable in a screenshot. */
function sampleImage(index, label) {
  const [from, to] = PALETTE[index % PALETTE.length];
  const width = 600 + (index % 3) * 220;
  const height = 480 + (index % 4) * 180;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="40" y="${height - 48}" font-family="Helvetica, Arial, sans-serif" font-size="72"
      font-weight="700" fill="white" fill-opacity="0.9">${String(index + 1).padStart(2, "0")}</text>
    <text x="40" y="70" font-family="Helvetica, Arial, sans-serif" font-size="28"
      fill="white" fill-opacity="0.75">${label} · ${width}×${height}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Short clips of ffmpeg's built-in sources, in the shapes and codecs uploads see. */
const VIDEOS = [
  { name: "testsrc-landscape.mp4", source: "testsrc2=size=640x360:rate=25", codec: "h264" },
  { name: "bars-portrait.mp4", source: "smptebars=size=360x640:rate=25", codec: "h264" },
  { name: "mandelbrot-square.webm", source: "mandelbrot=size=480x480:rate=25", codec: "vp9" },
  { name: "life.mp4", source: "life=size=480x320:rate=15:mold=10:ratio=0.2", codec: "h264" },
];

async function sampleVideo({ name, source, codec }) {
  const dir = await mkdtemp(join(tmpdir(), "substratum-seed-"));
  try {
    const path = join(dir, name);
    const encode =
      codec === "vp9"
        ? ["-c:v", "libvpx-vp9", "-deadline", "realtime"]
        : ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
    await promisify(execFile)(process.env.FFMPEG_PATH || "ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      source,
      "-t",
      "4",
      ...encode,
      path,
    ]);
    return await readFile(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function upload(name, buffer, type, boardId) {
  const body = new FormData();
  if (boardId) body.append("boardId", boardId);
  body.append("files", new Blob([buffer], { type }), name);
  const response = await call("/upload", { multipart: body });
  const result = response.ok ? await response.json().catch(() => null) : null;
  if (!result || result.uploaded !== 1) {
    throw new Error(
      `Uploading ${name} failed: ${response.status} ${result?.errors?.join("; ") ?? ""}`,
    );
  }
}

async function createBoard(name) {
  const response = await call("/boards", { form: { intent: "create", name } });
  const body = await response.json();
  if (!body.ok) throw new Error(`Creating board "${name}" failed: ${body.error}`);
  return body.id;
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

  const perBoard = Number(process.env.SUBSTRATUM_SEED_COUNT ?? 4);
  const boards = [
    { name: "Dark UI", video: 0 },
    { name: "Typography", video: 1, publish: true },
    { name: "Layout", video: 2 },
  ];

  let index = 0;
  for (const board of boards) {
    const id = await createBoard(board.name);
    for (let n = 0; n < perBoard; n++, index++) {
      await upload(
        `sample-${index + 1}.png`,
        await sampleImage(index, board.name),
        "image/png",
        id,
      );
    }
    const video = VIDEOS[board.video];
    await upload(video.name, await sampleVideo(video), mimeOf(video.name), id);

    if (board.publish) {
      const response = await call("/boards", { form: { intent: "publish", boardId: id } });
      const body = await response.json();
      console.log(`Created board "${board.name}" — published at ${BASE}/board/${body.slug}`);
    } else {
      console.log(`Created board "${board.name}".`);
    }
  }

  // Some media on no board at all, so the Stream and Triage have work in them.
  for (let n = 0; n < perBoard; n++, index++) {
    await upload(`sample-${index + 1}.png`, await sampleImage(index, "Unsorted"), "image/png");
  }
  const loose = VIDEOS[3];
  await upload(loose.name, await sampleVideo(loose), mimeOf(loose.name));

  console.log(`Uploaded ${index} images and ${boards.length + 1} videos.`);
  console.log(`\nDone — open ${BASE}`);
}

function mimeOf(name) {
  return name.endsWith(".webm") ? "video/webm" : "video/mp4";
}
