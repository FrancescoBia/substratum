import {
  CAPTURE_ENDPOINT,
  type CaptureErrorCode,
  type CaptureRequest,
  type CaptureResponse,
} from "@repo/shared";
import { getInstanceUrl, hasPermission } from "@/lib/instance";
import { syncSiteScripts, toggleSiteFix } from "@/lib/sites";

// Kept as it was when the menu only took images: it's the id Chrome already has
// registered on every install.
const MENU_ID = "save-image";

/** What a right-click landed on, in the words the notifications use. */
type Media = "image" | "video";

export default defineBackground(() => {
  // Registered at the top level so it survives service-worker restarts (MV3).
  browser.runtime.onInstalled.addListener(async () => {
    // Recreated rather than added to, so an update that changes the item (as
    // adding videos did) can't collide with the one already registered.
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: MENU_ID,
      title: "Save to Substratum",
      contexts: ["image", "video"],
    });
    syncSiteScripts();
  });

  // Site fixes follow their host permissions, whether granted from the options
  // page or revoked from chrome://extensions.
  browser.permissions.onAdded.addListener(() => syncSiteScripts());
  browser.permissions.onRemoved.addListener(() => syncSiteScripts());

  // The toolbar icon has no popup: a click switches the overlay fix for the
  // site it's on. toggleSiteFix has to be the first thing called, while the
  // click's user gesture still allows a permission prompt.
  browser.action.onClicked.addListener(async (tab) => {
    const outcome = await toggleSiteFix(tab);
    switch (outcome.kind) {
      case "on":
        flashBadge("on", "#16a34a");
        return;
      case "off":
        // Already-open tabs keep the fix until they're reloaded.
        flashBadge("off", "#6b7280");
        return;
      case "instance":
        notify(
          "That's your Substratum instance",
          "Seeing through overlays is for sites you save from, so there's nothing to switch here.",
        );
        return;
      case "not-a-site":
        notify(
          "Substratum can't run here",
          "Seeing through overlays only works on websites served over http or https.",
        );
        return;
      case "declined":
        return;
    }
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_ID) return;
    const media: Media = info.mediaType === "video" ? "video" : "image";

    // A <video> that hasn't picked a source yet has no address to report.
    if (!info.srcUrl) {
      notify(
        `Substratum can't save that ${media}`,
        `The page didn't say where that ${media} comes from. Playing it first sometimes helps.`,
      );
      return;
    }

    // The instance downloads the bytes itself, so a file with no address it
    // can resolve is a guaranteed rejection. Catching that here saves a
    // pointless round trip — and for a data: URL that round trip would upload
    // the whole file as a form field only to be told no.
    const unreachable = whyUnreachable(info.srcUrl, media);
    if (unreachable) {
      notify(`Substratum can't save that ${media}`, unreachable);
      return;
    }

    await capture(media, {
      sourceImageUrl: info.srcUrl,
      sourcePageUrl: info.pageUrl ?? info.frameUrl ?? "",
      sourcePageTitle: tab?.title ?? "",
    });
  });
});

async function capture(media: Media, fields: CaptureRequest) {
  const instance = await getInstanceUrl();
  if (!instance) {
    notify(
      "Substratum isn't set up",
      "Open the extension's options and add your instance URL.",
    );
    return;
  }
  if (!(await hasPermission(instance))) {
    notify(
      "Substratum needs permission",
      "Re-pair your instance in the extension's options.",
    );
    return;
  }

  const done = startWorking();
  try {
    // Form-encoded on purpose: this is a "simple" request, so the browser sends
    // no CORS preflight. credentials:"include" carries the instance's session
    // cookie — the assumption the auth spike exists to prove.
    const response = await fetch(instance + CAPTURE_ENDPOINT, {
      method: "POST",
      credentials: "include",
      body: new URLSearchParams(fields),
    });

    const result = await readCaptureResponse(response);
    if (result.ok) {
      done("✓", "#16a34a");
      return;
    }

    done("!", "#dc2626");
    notify(titleForCode(result.code, media), result.message);
  } catch (error) {
    done("!", "#dc2626");
    notify(
      "Couldn't reach your instance",
      error instanceof Error ? error.message : "The request failed.",
    );
  }
}

let working = 0;
let keepAlive: ReturnType<typeof setInterval> | undefined;

/**
 * Marks a capture as under way until the returned function is called with its
 * outcome badge.
 *
 * A video can take the instance a while — download, probe, store — and Chrome
 * stops a worker that goes 30s without an extension event or API call, taking
 * the outcome with it. A cheap API call every 20s resets that clock. (A slow
 * response is the other way to be stopped; the instance starts answering
 * within 10s to avoid it.) The badge says a save is under way meanwhile, so a
 * long one doesn't look like nothing happened.
 */
function startWorking(): (text: string, color: string) => void {
  working++;
  keepAlive ??= setInterval(
    () => void browser.runtime.getPlatformInfo(),
    20_000,
  );
  setBadge("…", "#6b7280");

  return (text, color) => {
    working--;
    if (working === 0) {
      clearInterval(keepAlive);
      keepAlive = undefined;
    }
    flashBadge(text, color);
  };
}

/**
 * Why the instance won't be able to download this, or null if the URL looks
 * fetchable. Both rejected cases are ordinary rather than exotic: `blob:` is
 * what a page uses for something it built in memory, and `data:` is something
 * embedded straight into the markup. Neither is an address that anything
 * outside that tab can resolve.
 *
 * For a video, `blob:` almost always means streaming: the page fetches it in
 * small pieces and feeds them to the player itself, as YouTube, Instagram, X
 * and most large sites do. There is no single file anywhere to point at.
 */
function whyUnreachable(srcUrl: string, media: Media): string | null {
  if (srcUrl.startsWith("blob:")) {
    return media === "video"
      ? "This site streams that video in pieces rather than serving it as one file, so your instance has nothing to download. Videos a page links to directly, as MP4 or WebM, save fine."
      : "This page keeps that image in memory rather than at a web address, so your instance has nothing to download. Opening the image in its own tab often gives a saveable URL.";
  }
  if (srcUrl.startsWith("data:")) {
    return `That ${media} is embedded directly in the page, so there's no address to download it from. Save it to your computer and upload it to Substratum instead.`;
  }
  if (!/^https?:$/i.test(protocolOf(srcUrl) ?? "")) {
    return `Substratum can only save ${media}s served over http or https.`;
  }
  return null;
}

function protocolOf(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}

/**
 * A slow capture's answer arrives as whitespace followed by the verdict (see
 * the instance's api.capture.ts), which `json()` reads as it would any other.
 *
 * A self-hosted instance usually sits behind a reverse proxy, so a failure can
 * arrive as that proxy's HTML error page rather than our JSON. Parsing blind
 * would turn a plain "502 Bad Gateway" into "Unexpected token '<'".
 */
async function readCaptureResponse(
  response: Response,
): Promise<CaptureResponse> {
  try {
    return (await response.json()) as CaptureResponse;
  } catch {
    return {
      ok: false,
      code: response.status === 401 ? "unauthenticated" : "server-error",
      message: `Your instance answered ${response.status} ${response.statusText || "with something Substratum couldn't read"}. If it sits behind a proxy, that is usually where to look.`,
    };
  }
}

function titleForCode(code: CaptureErrorCode, media: Media): string {
  switch (code) {
    case "unauthenticated":
      return "Sign in to Substratum first";
    case "unsupported-format":
      return `That ${media} format isn't supported`;
    case "too-large":
      return `That ${media} is too large`;
    case "fetch-failed":
      return `Couldn't download that ${media}`;
    default:
      return `Couldn't save that ${media}`;
  }
}

let clearBadge: ReturnType<typeof setTimeout> | undefined;

/** Quiet success signal — no popup when things simply work. */
function flashBadge(text: string, color: string) {
  setBadge(text, color);
  // While another capture is still under way, its "…" comes back afterwards.
  clearBadge = setTimeout(
    () => setBadge(working > 0 ? "…" : "", "#6b7280"),
    2500,
  );
}

function setBadge(text: string, color: string) {
  clearTimeout(clearBadge);
  browser.action.setBadgeText({ text });
  browser.action.setBadgeBackgroundColor({ color });
}

/** Failures are loud, so a save is never silently lost. */
function notify(title: string, message: string) {
  browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("/icon/128.png"),
    title,
    message,
  });
}
