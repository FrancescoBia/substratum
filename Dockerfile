# syntax=docker/dockerfile:1

# Debian rather than Alpine: better-sqlite3, sharp and argon2 all ship glibc
# prebuilds, so the image builds without hunting musl variants.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# `corepack prepare` materialises pnpm into the image. Without it corepack
# downloads pnpm on first use — which for the runtime stage means the container
# needs network access just to start.
RUN corepack enable && corepack prepare pnpm@10.3.0 --activate
WORKDIR /app

FROM base AS build
# Toolchain for better-sqlite3's native build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Manifests first, so dependency layers cache across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @repo/web...

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @repo/web build

# Build a production-only tree rather than pruning the dev one in place.
# `pnpm install --prod` over an existing node_modules skips resolution and
# leaves every dev package where it is — vite, playwright and typescript all
# shipped to production before this was caught. `deploy` constructs a fresh
# directory containing only what the app actually needs to run.
#
# --legacy because pnpm 10 otherwise wants inject-workspace-packages, which
# would copy workspace packages instead of symlinking them — and that breaks
# hot-reload for packages/shared during development. This is a build-time
# concern only, so it stays here rather than in pnpm-workspace.yaml.
RUN pnpm --filter @repo/web deploy --prod --legacy /deploy

FROM base AS runtime
ENV NODE_ENV=production
ENV SUBSTRATUM_DATA_DIR=/data
# Stays 3000 inside the container, where it collides with nothing — the port
# that matters is the published one, set in docker-compose.yml.
ENV PORT=3000

COPY --from=build /deploy /app
# `deploy` honours .gitignore, and build/ is ignored — so the compiled server
# has to be copied in explicitly. Without this the image builds fine and then
# fails to start, which is the worst way to find out.
COPY --from=build /app/apps/web/build /app/build

# The SQLite database and every stored image live here — one volume is the
# whole instance, which is what makes the backup story a single line.
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data
USER node
WORKDIR /app

EXPOSE 3000
# Straight to node, and to the CLI's real entry point rather than the .bin shim:
# pnpm's shims are /bin/sh wrappers, so `node` on one is a syntax error. Going
# through pnpm instead would work but adds a package-manager process to every
# container start.
CMD ["node", "./node_modules/@react-router/serve/dist/cli.js", "./build/server/index.js"]
