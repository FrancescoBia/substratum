# AGENTS.md

pnpm monorepo: `apps/web` (React Router 8 server + UI, SQLite/Drizzle), `apps/extension` (Chrome MV3, WXT), `apps/storybook`, `packages/ui` (design system), `packages/shared` (capture API types). The README covers product behaviour and commands. Read its "How it works" section before you change behaviour, because several omissions are deliberate.

## Don't touch user data

- `apps/web/data/` is the local dev instance (SQLite, images, `secret.key`) that `pnpm dev` runs against. It's gitignored and has no backup, so don't delete or reset it unless asked. Tests and scripts use their own data directories.
- Any script or one-off command that imports app modules (`config.server.ts`) must set `SUBSTRATUM_DATA_DIR` to a scratch path. Otherwise it defaults to `./data`.
- Only `rm` paths you created yourself in this session.
- `apps/web/.env` may point at a real S3 bucket. Don't run `migrate:storage` or `check:bucket`, and don't upload against the dev server with a bucket configured, unless you were asked to.

## Before calling a change done

CI (`.github/workflows/ci.yml`) blocks on all of these, so run the relevant ones:

```bash
pnpm format:check   # blocking — run `pnpm format` to fix
pnpm typecheck
pnpm test:unit
pnpm test:browser   # component tests needing real layout; Vitest browser mode, headless Chromium
pnpm test:e2e       # needs ffmpeg/ffprobe on PATH; uses its own throwaway instance on :3100
pnpm build
```

`pnpm lint` reports warnings only and doesn't block. Don't add new warnings.

## Conventions that aren't obvious

- **Migrations:** change the Drizzle schema and run `pnpm db:generate`. Never hand-write or edit files in `apps/web/drizzle/`. Migrations run automatically on startup.
- **Server-only code** uses the `*.server.ts` suffix. Config comes only from env vars with working defaults (see `apps/web/app/lib/config.server.ts`). Never add a required config file.
- **`@repo/ui`** has no build step and resolves through its `exports` map, not tsconfig paths. After `shadcn add`, change `import { cn } from "cn"` to `@repo/ui/lib/utils`, drop the `cn` dependency the CLI adds, and remove `"use client"` (see `packages/ui/README.md`).
- **Tags are hidden** behind `TAGS_ENABLED` in `apps/web/app/lib/features.ts`. Keep tag code working, but don't surface it in the UI.
- **e2e auth** goes through the real `/setup` endpoint (`e2e/auth.setup.ts`). Don't add dev-only login routes or auth bypasses.
- **Video** is never transcoded. ffmpeg/ffprobe are required at startup.
- **Versions** are kept in sync across the root, `apps/extension`, `packages/ui` and `packages/shared`. Bump all of them together.
- **Commits** follow Conventional Commits with an optional scope: `feat(web): …`, `fix: …`, `chore: …`.

## Git & releases

- Pushing directly to `main` is allowed. Please check with the developer before committing anything though.
- Pushing a `v*` tag publishes the GHCR image that self-hosters pull as `:latest`. Never create or push tags unless explicitly asked.
