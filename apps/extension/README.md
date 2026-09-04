# Substratum — Chrome extension

Right-click any image on the web and choose **Save to Substratum**. The image
lands in your own self-hosted instance.

This is the accelerator, not the only door — the web app takes manual uploads and
is fully usable without ever installing this. See the [root README](../../README.md)
for hosting.

> [!NOTE]
> Not on the Chrome Web Store yet, so it has to be loaded unpacked. See
> [Loading it](#loading-it).

## How it works

The whole extension is a background service worker plus an options page. There
are no content scripts, no popup, and no injected UI — nothing of Substratum's
ever runs inside a page you're browsing.

**The extension never touches image bytes.** It sends your instance three
strings — the image URL, the page URL, the page title — and the instance
downloads the image itself. That's the reason the permissions are as small as
they are: no host permission for third-party sites, and so no "read your data on
all websites" warning at install.

| Permission | Why |
|---|---|
| `contextMenus` | The right-click item |
| `notifications` | Reporting failures |
| `storage` | Remembering your instance URL |
| `optional_host_permissions: *://*/*` | Requested at runtime for **your instance's origin only** |

That last one looks alarming and isn't what it appears to be. One listed
extension has to serve every self-hosted instance, so the instance origin can't
be a fixed host permission in the manifest — it isn't known until you type it in.
The extension asks for exactly the origin you paired and nothing else. Chrome
requires a user gesture for that prompt, which is why pairing lives behind a
button rather than happening as you type.

### Pairing and auth

You enter your instance URL on the options page; it's normalized to a bare origin
and stored. Captures then go out with `credentials: "include"`, so Chrome attaches
the instance's own session cookie — you're authenticated because you're signed in
to Substratum in the same browser. There's no separate token, no second login.

This rests on Chrome sending a `SameSite=Lax` cookie on an extension-originated
request. **Verified 2026-09-04** in a real Chrome; the options page's *Check
connection* button exists to confirm it against your own instance, and reports the
signed-in email when it works.

Requests are deliberately kept "simple" — form-encoded body, no custom headers —
so the browser sends no CORS preflight. React Router doesn't route `OPTIONS`, so
avoiding preflight avoids needing a server to answer it. The instance echoes CORS
headers only to `chrome-extension://` origins.

### What it won't save

Two cases are rejected in the extension, before any request goes out, because the
instance would have nothing to download:

- **`blob:`** — an image the page built in memory. Opening it in its own tab often
  yields a real URL.
- **`data:`** — an image embedded straight into the markup. Without the early
  check, the round trip would upload the whole image as a form field only to be
  told no.

Anything not `http`/`https` is refused for the same reason. Beyond that, the
instance decides: raster formats only (`jpeg`, `png`, `gif`, `webp`, `avif` — SVG
is out of scope for v1), 50 MB maximum. The rules live in
[`packages/shared`](../../packages/shared/src/index.ts) so the extension and the
server can't drift on them.

### Feedback

Success is quiet, failure is loud. A save flashes a green ✓ badge for 2.5s and
shows no popup. A failure raises a system notification with copy specific to the
reason — not signed in, format unsupported, too large, couldn't download,
instance unreachable — so a lost save is never silent and you learn something
actionable.

Captures are synchronous by design: `/api/capture` responds only once the image is
actually stored, so the ✓ is truthful. There's no retry queue — you retry by
right-clicking again.

## Development

From the repo root, after `pnpm install`:

| Command | Does |
|---|---|
| `pnpm --dir apps/extension dev` | WXT dev mode — opens a Chrome profile with the extension loaded, with hot reload |
| `pnpm --dir apps/extension build` | Production build into `.output/chrome-mv3` |
| `pnpm --dir apps/extension zip` | Package for the Chrome Web Store |
| `pnpm --dir apps/extension typecheck` | `tsc --noEmit` |

You'll want a web app to point at — `pnpm dev` from the root runs one on
http://localhost:3000.

```
entrypoints/background.ts     context menu, capture, badge, notifications
entrypoints/options/          the pairing page (React)
lib/instance.ts               stored instance URL + permission helpers
wxt.config.ts                 the MV3 manifest
```

### Loading it

```bash
pnpm --dir apps/extension build
```

Then `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select `apps/extension/.output/chrome-mv3`. Open the extension's options, enter
your instance URL, click **Pair instance**, and accept the permission prompt.

The options page opens as an embedded dialog rather than a tab. If the permission
prompt doesn't appear there, open the options page in its own tab and retry.

## Before publishing

- **Pin the extension ID.** The instance accepts capture calls from any
  `chrome-extension://` origin until `SUBSTRATUM_EXTENSION_ID` is set. It's
  chicken-and-egg with the store: publish, take the assigned ID, set the env var,
  rebuild. See [`cors.server.ts`](../web/app/lib/cors.server.ts).
- Chrome Web Store listing — screenshots, privacy disclosure, submission. Icons
  and `wxt zip` are already in place.

## License

[AGPL-3.0](../../LICENSE), same as the rest of Substratum.
