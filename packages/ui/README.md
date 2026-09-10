# @repo/ui

The design system: the theme, the shadcn primitives built on it, and `cn`.
Consumed by both `apps/web` and `apps/extension`, which is why it isn't sitting
in `apps/web` any more.

The primitives are Base UI (`@base-ui/react`), from shadcn's `base-nova`
registry — `nova` is the same visual style the Radix build used, so the switch
was a change of primitive library, not of look.

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

Then fix two things the CLI leaves behind:

- **The `cn` import.** Every component in the `base-nova` registry is published
  with a literal `import { cn } from "cn"`, which the CLI does not rewrite
  through the `utils` alias — and `cn` is a real, unrelated package on npm, so
  it installs and typechecks rather than failing loudly. It should read
  `@repo/ui/lib/utils`. The CLI also adds `cn` to `dependencies`; drop it.
- **`"use client"`.** Some components ship with it. Nothing here is
  server-rendered through RSC (`rsc: false`), so it goes.

Then `pnpm format`, since the registry's formatting is not ours.

## Composing primitives

Base UI has no `asChild`. Two replacements, and the choice between them matters:

- **`render`**, for swapping the rendered element while keeping the primitive's
  semantics: `<DropdownMenuTrigger render={<Button />}>`. Both sides are native
  buttons here, which is what `Button` expects.
- **`buttonVariants()`**, for anything that only wants the _look_ of a button.
  `Button` always applies button semantics — `type="button"`, or `role="button"`
  under `nativeButton={false}` — which would override the semantics of an `<a>`
  or of a `<span>` inside a `<label>`. So links and label-wrapped spans take the
  classes directly:

  ```tsx
  <a href="/export" download className={buttonVariants({ variant: "ghost" })}>
  ```

  Reach for this whenever the element is not really a button. Using `render` on
  one logs a Base UI console error and quietly damages the accessibility tree.

One more Base UI behaviour that is easy to lose an afternoon to: `Dialog.Popup`
calls `stopPropagation()` on the arrow keys, `Home` and `End`, so they cannot
leak out of a popup into whatever is behind it. A dialog that steers itself with
the arrow keys from a listener on `window` — the lightbox in `apps/web` does —
has to listen in the **capture** phase, or it never sees them.

## What belongs here

Anything both consumers would want: tokens, primitives, the light/dark
contract. Not app chrome — the web app's sidebar, lightbox and mosaic grid stay
in `apps/web`, along with the CSS that only they use.

`theme-provider` is here rather than in the app because the `.dark` class it
writes is half of the theme contract; the tokens in `globals.css` are the other
half, and they should not be able to drift apart. `ThemeScript` is only useful
to a server-rendered consumer, and a client-rendered one can ignore it.
