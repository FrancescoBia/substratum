# Substratum — Chrome extension

Right-click any image or video on the web and choose **Save to Substratum**. It
lands in your own self-hosted instance.

This is the accelerator, not the only door — the web app takes manual uploads and
is fully usable without ever installing this. See the [root README](../../README.md)
for hosting.

> [!NOTE]
> Not on the Chrome Web Store yet, so it has to be loaded unpacked. See
> [Loading it](#loading-it).

## How it works

The whole extension is a background service worker plus an options page. There
is no popup and no injected UI, and out of the box nothing of Substratum's runs
inside a page you're browsing. The one exception is opt-in, per site — see
[Hidden images](#hidden-images).

**The extension never touches the bytes.** It sends your instance three
strings — the image or video URL, the page URL, the page title — and the
instance downloads the file itself. That's the reason the permissions are as small as
they are: no host permission for third-party sites, and so no "read your data on
all websites" warning at install.

| Permission                           | Why                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| `contextMenus`                       | The right-click item                                                                  |
| `notifications`                      | Reporting failures                                                                    |
| `scripting`                          | Registering the opt-in [hidden-image fixes](#hidden-images); no install warning       |
| `storage`                            | Remembering your instance URL                                                         |
| `optional_host_permissions: *://*/*` | Requested at runtime for **your instance's origin**, and any site fixes you switch on |

That last one looks alarming and isn't what it appears to be. One listed
extension has to serve every self-hosted instance, so the instance origin can't
be a fixed host permission in the manifest — it isn't known until you type it in.
The extension asks for exactly the origin you paired, plus the sites you
explicitly switch on, and nothing else. Chrome requires a user gesture for that
prompt, which is why pairing lives behind a button rather than happening as you
type.

### Hidden images

Some sites cover their images with an empty, transparent element — Instagram
lays one over every photo. Right-click lands on that element instead of the
image, so Chrome shows no image menu at all: neither **Save to Substratum** nor
its own **Save image as…**.

The options page has a switch per affected site (currently just Instagram).
Switching one on requests that site's host permission; the background worker
sees the grant and registers a small content script
([`unshield.content.ts`](entrypoints/unshield.content.ts)) for that site only.
Revoking the permission, from the options page or `chrome://extensions`,
unregisters it again — the permission is the only state.

The script is deliberately narrow, so the site keeps behaving as it did:

- It acts only on a **right-button** press. Left clicks, hovers, taps and
  keyboard input never reach it.
- It acts only when an `<img>` is under the cursor and **everything** stacked
  above it is an empty element — no children, no text. An overlay with any
  content (a button, a caption, a like count) makes it stand aside.
- It makes those empty elements click-through (`pointer-events: none`) just
  long enough for Chrome to hit-test the context menu, then restores their
  original inline style on the next task — or after 1s if no menu follows.
- It doesn't rely on the site's class names, and it never reads or sends
  anything: the capture itself still goes through the ordinary image menu.

Already-open tabs pick it up on reload.

### Pairing and auth

You enter your instance URL on the options page; it's normalized to a bare origin
and stored. Captures then go out with `credentials: "include"`, so Chrome attaches
the instance's own session cookie — you're authenticated because you're signed in
to Substratum in the same browser. There's no separate token, no second login.

This rests on Chrome sending a `SameSite=Lax` cookie on an extension-originated
request. **Verified 2026-09-04** in a real Chrome; the options page's _Check
connection_ button exists to confirm it against your own instance, and reports the
signed-in email when it works.

Requests are deliberately kept "simple" — form-encoded body, no custom headers —
so the browser sends no CORS preflight. React Router doesn't route `OPTIONS`, so
avoiding preflight avoids needing a server to answer it. The instance echoes CORS
headers only to `chrome-extension://` origins.

### What it won't save

Two cases are rejected in the extension, before any request goes out, because the
instance would have nothing to download:

- **`blob:`** — something the page built in memory. For an image, opening it in
  its own tab often yields a real URL. For a video it almost always means
  streaming: YouTube, Instagram, X, Vimeo and most large sites fetch a video in
  small pieces and feed them to the player themselves, so there's no single file
  anywhere to save. Nothing in the extension can change that.
- **`data:`** — something embedded straight into the markup. Without the early
  check, the round trip would upload the whole file as a form field only to be
  told no.

Anything not `http`/`https` is refused for the same reason. Beyond that, the
instance decides, from the downloaded bytes, by the same rules as a manual
upload: raster images (`jpeg`, `png`, `gif`, `webp`, `avif` — SVG is out of scope
for v1) up to 50 MB, and MP4, MOV or WebM videos with H.264, VP8 or VP9 inside up
to 95 MB. The limits live in [`packages/shared`](../../packages/shared/src/index.ts)
so the extension and the server can't drift on them.

Videos that save are the ones a page links to as a plain file — portfolio sites,
blogs, CMS-hosted clips, a `.mp4` opened in its own tab.

The [hidden-image fix](#hidden-images) only looks for images. Instagram's videos
are streamed anyway, so seeing through its overlays to them would only trade a
missing menu for a "can't save" notice.

### Feedback

Success is quiet, failure is loud. A save flashes a green ✓ badge for 2.5s and
shows no popup. A failure raises a system notification with copy specific to the
reason — not signed in, format unsupported, too large, couldn't download,
instance unreachable — so a lost save is never silent and you learn something
actionable.

Captures are synchronous by design: `/api/capture` responds only once the file is
actually stored, so the ✓ is truthful. There's no retry queue — you retry by
right-clicking again. While a capture is working, the badge shows a grey …

A video can take the instance longer than Chrome lets an extension's worker wait.
Chrome stops the worker when a `fetch()` response takes more than 30s to arrive,
or when it goes 30s without an extension event or API call, and the ✓ or the
failure notice goes with it. So:

- A capture that hasn't finished within 10s sends its `200` and headers anyway,
  then a space every 10s, then the real JSON verdict. JSON allows leading
  whitespace, so the body parses exactly as before; the verdict is in `ok`, not
  in the status. The response carries `Cache-Control: no-transform` and
  `X-Accel-Buffering: no`, so compression and nginx don't hold the spaces back.
- The worker makes a no-op API call every 20s while a capture is under way.

The instance gives the download itself 15s of silence and 3 minutes in total.

## Development

From the repo root, after `pnpm install`:

| Command                               | Does                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm --dir apps/extension dev`       | WXT dev mode — opens a Chrome profile with the extension loaded, with hot reload |
| `pnpm --dir apps/extension build`     | Production build into `.output/chrome-mv3`                                       |
| `pnpm --dir apps/extension zip`       | Package for the Chrome Web Store                                                 |
| `pnpm --dir apps/extension typecheck` | `tsc --noEmit`                                                                   |

You'll want a web app to point at — `pnpm dev` from the root runs one on
http://localhost:5173.

```
entrypoints/background.ts     context menu (images and videos), capture, badge, notifications
entrypoints/options/          the pairing page (React)
entrypoints/unshield.content.ts  opt-in hidden-image fix, registered at runtime
lib/instance.ts               stored instance URL + permission helpers
lib/sites.ts                  sites with hidden images + script registration
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
