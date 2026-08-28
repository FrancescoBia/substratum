# Substratum

Collect visual inspiration while you browse. Right-click any image, and it lands in your own self-hosted library — organized into boards and tags later, on your own time.

Substratum is two pieces: a **web app** you host yourself, and a **Chrome extension** that saves images into it. One person per instance; boards you choose to publish become public pages.

> **Status: v1 feature-complete, not yet released.** Every surface in the design
> is built — capture, upload, boards, tags, triage, trash, export, published
> boards. One piece is still open: images are stored on local disk only — the
> S3-compatible backend isn't built yet. Beyond that what's missing is
> distribution — no image is published to GHCR, so the quickstart needs
> `docker compose up -d --build` against a clone, and the extension isn't on the
> Chrome Web Store.

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
mapping, and published board links are built from it. Then install the Chrome extension, open its options, and point it at your instance URL.

Everything — the SQLite database and your stored images — lives in the single `data` volume. Back that up and you've backed up your whole library.

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

The whole instance is one volume. Either snapshot the volume, or copy the database out with SQLite's backup command and archive the images directory alongside it.

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

The web app runs on http://localhost:3000.

| Command | Does |
|---|---|
| `pnpm dev` | Run the web app in dev mode |
| `pnpm seed` | Fill a running instance with sample images and boards |
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
