# @repo/storybook

One Storybook for the whole repo. It owns the runner and config only; stories
live next to what they describe and are collected from:

- `packages/ui/stories/` — the design system's primitives
- `apps/web/app/**/*.stories.tsx` — web's own components

```bash
pnpm storybook                          # dev server on :6006, from the repo root
pnpm --filter @repo/storybook build     # static build into storybook-static/
```

Each workspace typechecks its own stories. `@repo/ui` carries
`@storybook/react-vite` as a dev dependency for the `Meta` / `StoryObj` types.
`@repo/web` must not: its production image is built with `pnpm deploy`, which
resolves web's whole dependency tree, and a broken package deep in Storybook's
tree once failed that build. Instead, web's `tsconfig.json` maps
`@storybook/react-vite` to this app's copy, so web stories can only
`import type` from it.

## Things that are easy to trip over

- **Tailwind.** Its automatic scan starts in this directory and sees nothing
  else, so `.storybook/storybook.css` names every story location with
  `@source`. A new place for stories needs a line there. web's `app.css`
  excludes `*.stories.tsx` from the app's own build.
- **Images.** Web components build `/img/<id>/<variant>` URLs from an id. A
  plugin in `.storybook/image-fixtures.ts` answers those from `fixtures/`, so
  `fixtures/landscape.jpg` is the image with id `landscape`, at every variant.
  Drop a file in and use its name.
- **Routing.** Components that use React Router need a router: wrap the story
  in `createRoutesStub` (see `image-grid.stories.tsx`).
- **One React.** Stories and components resolve `react` and `react-router` from
  different workspaces; `resolve.dedupe` in `main.ts` keeps it to one copy.
