# Substratum

Collect visual inspiration while you browse. Right-click any image, and it lands in your own self-hosted library — organized into boards and tags later, on your own time.

Substratum is two pieces: a **web app** you host yourself, and a **Chrome extension** that saves images into it. One person per instance; boards you choose to publish become public pages.

> [!WARNING]
> **Not production ready.** Substratum is in active development and not yet ready for production use.

> **Status: v1 feature-complete.** Every surface in the design is built —
> capture, upload, boards, tags, triage, trash, export, published boards, and
> image storage on either local disk or an S3-compatible bucket. The container
> image is published to GHCR, but the extension isn't on the Chrome Web Store,
> so it has to be loaded unpacked.

## How it works

A few behaviours that aren't obvious from the outside:

- **Nothing is deduplicated.** Saving the same image twice gives you two copies — Substratum never decides that two saves are "the same".
- **Boards are views, not folders.** An image can sit on any number of boards, or none, and deleting a board never deletes the images on it.
- **Published board URLs are frozen.** A board's public slug is generated the first time you publish it and never changes, so renaming the board won't break links people already have. You can edit a slug by hand, but that will.
- **Published boards show images and source links only** — never your tags or notes.
- **Deleted images sit in the Trash for 30 days** — out of the stream, off every board, and off any public page — until they're purged automatically or you empty it by hand.

## Quickstart (self-hosting)

```yaml
# docker-compose.yml
services:
  app:
    image: ghcr.io/francescobia/substratum:latest
    ports:
      # Change the left-hand number to publish it somewhere else
      - "4677:3000"
    volumes:
      - data:/data
    environment:
      SUBSTRATUM_URL: http://localhost:4677
    restart: unless-stopped

volumes:
  data:
```

```bash
docker compose up -d
```

Open <http://localhost:4677> and the first screen asks you to create your account.

`SUBSTRATUM_URL` must match the address you actually reach the instance on — a domain,
or `http://localhost:<published port>`. The app can't see the host side of a port
mapping, and published board links are built from it. Left unset, the app falls back
to the origin each request arrives on (honouring `X-Forwarded-Proto` and
`X-Forwarded-Host`), which is fine locally but a guess anywhere public — set it. Then
install the Chrome extension, open its options, and point it at your instance URL.

By default, everything — the SQLite database and your stored images — lives in the single `data` volume. Back that up and you've backed up your whole library.

### Storing images in a bucket

Optional. Left alone, images sit on local disk in the `data` volume and there is
nothing to configure. To keep them in an S3-compatible bucket instead —
Cloudflare R2, Backblaze B2, MinIO — set these alongside `SUBSTRATUM_URL`:

| Variable | Default | |
|---|---|---|
| `SUBSTRATUM_S3_BUCKET` | — | Setting this is what moves storage to the bucket. |
| `SUBSTRATUM_S3_ENDPOINT` | — | API origin, e.g. `https://<account>.r2.cloudflarestorage.com` |
| `SUBSTRATUM_S3_ACCESS_KEY_ID` | — | |
| `SUBSTRATUM_S3_SECRET_ACCESS_KEY` | — | |
| `SUBSTRATUM_S3_REGION` | `us-east-1` | R2 wants `auto`. |
| `SUBSTRATUM_S3_FORCE_PATH_STYLE` | `true` | Path-style addressing, which R2, B2 and MinIO all accept. Set it `false` for an AWS S3 bucket created after 2020. |
| `SUBSTRATUM_S3_PREFIX` | — | Key prefix, so one bucket can hold more than one instance. |

The first four go together: set the bucket and leave one of the others out and
the app stops at startup naming what's missing, rather than quietly carrying on
against local disk and splitting your library across two places.

Image bytes are still served by the app rather than from the bucket directly.
`/img/:id/:variant` is where the published-board check happens, and handing out
bucket URLs would route around it — so a bucket is storage here, not a CDN.
Operators wanting CDN offload put a proxy in front.

> [!IMPORTANT]
> **A bucket splits your backups in two.** The `data` volume then holds only the
> database, so snapshotting it no longer captures your images — the bucket is a
> second thing to back up, with its own schedule and its own retention. Note
> also that switching an existing instance over doesn't move the images already
> on disk: they stay where they are, and the app will look for them in the
> bucket.

### Upgrading

```bash
docker compose pull && docker compose up -d
```

Database migrations run automatically on startup.

If you build the image yourself from this repo rather than pulling it, use:

```bash
docker compose up -d --build
```

Plain `docker compose up -d` reuses the existing image even when the Dockerfile
has changed, which produces confusing failures — a container whose internals
don't match the compose file it was started from.

### Forgotten password

```bash
docker compose exec app node ./scripts/reset-password.ts
```

It asks for a new password and signs out every existing session.

### Backups

The whole instance is one volume, unless you've moved images to a bucket — see
the caveat above, which makes that two things to back up rather than one. Either
snapshot the volume, or copy the database out with SQLite's backup command and
archive the images directory alongside it.

**Export all** in the sidebar downloads a zip of your original images plus a
`manifest.json` describing where each came from and how you'd organized it —
boards, tags, notes. That's your escape hatch: everything is plain files and JSON,
so nothing here holds your collection hostage. It's for portability rather than
backups, since it excludes the Trash and won't restore an instance on its own.

## Development

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm dev
```

The web app runs on http://localhost:3000. Any other port works too — `pnpm dev --port
4000` — and published board links follow the port you're actually on.

| Command | Does |
|---|---|
| `pnpm dev` | Run the web app in dev mode |
| `pnpm seed` | Fill a running instance with sample images and boards (`--url http://localhost:<port>` if it isn't on 3000) |
| `pnpm test:e2e` | Run every Playwright spec against a throwaway instance |
| `pnpm shots` | Regenerate just the screenshots in `apps/web/screenshots/` |
| `pnpm build` | Build every workspace package |
| `pnpm typecheck` | Typecheck every workspace package |
| `pnpm db:generate` | Generate a Drizzle migration from schema changes |

### Seeing the app without clicking through setup

The app is behind a login, which makes casual review awkward. Two ways round it,
neither of which adds a bypass to the app itself:

- **`pnpm seed`** against a fresh instance creates an owner, prints the generated
  password, and uploads sample images. On an instance that already has an owner it
  needs `SUBSTRATUM_SEED_EMAIL` and `SUBSTRATUM_SEED_PASSWORD` — it will never guess.
- **`pnpm shots`** spins up a throwaway instance, authenticates over HTTP, and
  writes a PNG of every view. Reviewing the UI is then a folder of images.

The Playwright suite authenticates the same way: a setup project posts to the real
`/setup` endpoint and saves the session, so no test types into the login form and
the app needs no dev-only login route.

Layout:

```
apps/web          the server: database, storage, ingest, public pages, UI
apps/extension    the Chrome extension (MV3, built with WXT)
packages/shared   types shared by the capture API
```

## License

[AGPL-3.0](LICENSE). You may use, modify, and host Substratum freely, including commercially — but if you modify it and offer it to others over a network, you must publish your modified source. No fork of Substratum can be made closed-source.
