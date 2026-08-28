import { CAPTURE_ENDPOINT, type CaptureErrorCode, type CaptureResponse } from "@repo/shared";
import { getInstanceUrl, hasPermission } from "@/lib/instance";

const MENU_ID = "save-image";

export default defineBackground(() => {
  // Registered at the top level so it survives service-worker restarts (MV3).
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: MENU_ID,
      title: "Save to Substratum",
      contexts: ["image"],
    });
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_ID || !info.srcUrl) return;

    // The instance downloads the bytes itself, so an image with no
    // address it can resolve is a guaranteed rejection. Catching that here
    // saves a pointless round trip — and for a data: URL that round trip would
    // upload the whole image as a form field only to be told no.
    const unreachable = whyUnreachable(info.srcUrl);
    if (unreachable) {
      notify("Substratum can't save that image", unreachable);
      return;
    }

    await capture({
      sourceImageUrl: info.srcUrl,
      sourcePageUrl: info.pageUrl ?? info.frameUrl ?? "",
      sourcePageTitle: tab?.title ?? "",
    });
  });
});

async function capture(fields: {
  sourceImageUrl: string;
  sourcePageUrl: string;
  sourcePageTitle: string;
}) {
  const instance = await getInstanceUrl();
  if (!instance) {
    notify("Substratum isn't set up", "Open the extension's options and add your instance URL.");
    return;
  }
  if (!(await hasPermission(instance))) {
    notify("Substratum needs permission", "Re-pair your instance in the extension's options.");
    return;
  }

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
      flashBadge("✓", "#16a34a");
      return;
    }

    flashBadge("!", "#dc2626");
    notify(titleForCode(result.code), result.message);
  } catch (error) {
    flashBadge("!", "#dc2626");
    notify(
      "Couldn't reach your instance",
      error instanceof Error ? error.message : "The request failed.",
    );
  }
}

/**
 * Why the instance won't be able to download this image, or null if the URL
 * looks fetchable. Both rejected cases are ordinary rather than exotic: `blob:`
 * is what a page uses for an image it built in memory, and `data:` is one
 * embedded straight into the markup. Neither is an address that anything
 * outside that tab can resolve.
 */
function whyUnreachable(srcUrl: string): string | null {
  if (srcUrl.startsWith("blob:")) {
    return "This page keeps that image in memory rather than at a web address, so your instance has nothing to download. Opening the image in its own tab often gives a saveable URL.";
  }
  if (srcUrl.startsWith("data:")) {
    return "That image is embedded directly in the page, so there's no address to download it from. Save it to your computer and upload it to Substratum instead.";
  }
  if (!/^https?:$/i.test(protocolOf(srcUrl) ?? "")) {
    return "Substratum can only save images served over http or https.";
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
 * A self-hosted instance usually sits behind a reverse proxy, so a failure can
 * arrive as that proxy's HTML error page rather than our JSON. Parsing blind
 * would turn a plain "502 Bad Gateway" into "Unexpected token '<'".
 */
async function readCaptureResponse(response: Response): Promise<CaptureResponse> {
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

function titleForCode(code: CaptureErrorCode): string {
  switch (code) {
    case "unauthenticated":
      return "Sign in to Substratum first";
    case "unsupported-format":
      return "That image format isn't supported";
    case "too-large":
      return "That image is too large";
    case "fetch-failed":
      return "Couldn't download that image";
    default:
      return "Couldn't save that image";
  }
}

/** Quiet success signal — no popup when things simply work. */
function flashBadge(text: string, color: string) {
  browser.action.setBadgeText({ text });
  browser.action.setBadgeBackgroundColor({ color });
  setTimeout(() => browser.action.setBadgeText({ text: "" }), 2500);
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
