# @repo/ui

The design system: the theme, the shadcn primitives built on it, and `cn`.
Consumed by both `apps/web` and `apps/extension`, which is why it isn't sitting
in `apps/web` any more.

```
src/components/   shadcn primitives, plus theme-provider
src/lib/utils.ts  cn()
src/styles/       globals.css — Tailwind, tokens, base layer
```

## Using it from an app

Depend on it, run Tailwind's Vite plugin, and import the stylesheet once from
the app's CSS entry:

```css
@import "@repo/ui/globals.css";
```

That pulls in Tailwind itself, so the app should not `@import "tailwindcss"` as
well. Then `import { Button } from "@repo/ui/components/button"`.

No `tsconfig` paths are involved anywhere — `tsc` and the bundlers all resolve
through the `exports` map in `package.json`, which is deliberately the only
place that mapping is written down.

There is no build step. The package ships TypeScript and the apps compile it,
which is only reasonable because both are Vite-based — but it means there is no
`dist` to fall out of date, and editing a primitive hot-reloads in the app.

## Adding a component

From here, where `components.json` and the pinned CLI both live:

```bash
cd packages/ui && pnpm exec shadcn add tooltip
```

Check the generated import of `cn`. Some components in the
`radix-nova` registry are published with a literal `import { cn } from "cn"`,
which the CLI does not rewrite through the `utils` alias — and `cn` is a real,
unrelated package on npm, so it installs and typechecks rather than failing
loudly. It should read `@repo/ui/lib/utils`.

## What belongs here

Anything both consumers would want: tokens, primitives, the light/dark
contract. Not app chrome — the web app's sidebar, lightbox and mosaic grid stay
in `apps/web`, along with the CSS that only they use.

`theme-provider` is here rather than in the app because the `.dark` class it
writes is half of the theme contract; the tokens in `globals.css` are the other
half, and they should not be able to drift apart. `ThemeScript` is only useful
to a server-rendered consumer, and a client-rendered one can ignore it.
