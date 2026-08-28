/**
 * Fills a running instance with sample images and boards, so a reviewer gets
 * from clone to something worth looking at in one command.
 *
 *   pnpm dev            # in one terminal
 *   pnpm seed           # in another
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

const BASE = (process.env.SUBSTRATUM_URL ?? "http://localhost:3000").replace(/\/$/, "");

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

await signIn();

const COUNT = Number(process.env.SUBSTRATUM_SEED_COUNT ?? 12);
for (let index = 0; index < COUNT; index++) await upload(index);
console.log(`Uploaded ${COUNT} sample images.`);

for (const name of ["Dark UI", "Typography", "Layout"]) {
  const response = await call("/boards", { form: { intent: "create", name } });
  const body = await response.json();
  if (body.ok) console.log(`Created board "${name}".`);
}

console.log(`\nDone — open ${BASE}`);
