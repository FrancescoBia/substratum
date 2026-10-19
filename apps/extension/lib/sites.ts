/**
 * Sites that hide their images and videos behind overlays, and the opt-in fix
 * for each.
 *
 * A site gets the fix in one of two ways:
 *
 * - **Listed** below, switched on from the options page. Its host permission is
 *   the whole of its state, so revoking that from chrome://extensions switches
 *   it off just the same.
 * - **Added** by clicking the toolbar icon on it (see `toggleSiteFix`). The
 *   permission alone can't mark these: pairing grants instance origins the
 *   same kind of permission, and an old instance's grant is never taken back.
 *   So an added site is one whose origin is stored here *and* still granted;
 *   revoking the permission still switches it off, and drops it from storage.
 *
 * The background worker keeps one registration of the unshield content script
 * matching every site that's on.
 */

import { getInstanceUrl, originPattern, toOrigin } from "./instance";

export type Site = {
  id: string;
  name: string;
  matches: string[];
};

export const SITES: Site[] = [
  { id: "instagram", name: "Instagram", matches: ["*://*.instagram.com/*"] },
];

const ADDED_KEY = "overlaySites";

/** Bundle path WXT gives entrypoints/unshield.content.ts. */
const UNSHIELD_SCRIPT = "content-scripts/unshield.js";

const SCRIPT_ID = "unshield";

export function isSiteEnabled(site: Site): Promise<boolean> {
  return browser.permissions.contains({ origins: site.matches });
}

/** Must be called from a user gesture, before any await — same rule as pairing. */
export function enableSite(site: Site): Promise<boolean> {
  return browser.permissions.request({ origins: site.matches });
}

export function disableSite(site: Site): Promise<boolean> {
  return browser.permissions.remove({ origins: site.matches });
}

/** Origins added from the toolbar whose permission is still granted. */
export async function getAddedSites(): Promise<string[]> {
  const stored = await readAdded();
  const granted = await Promise.all(
    stored.map((origin) =>
      browser.permissions.contains({ origins: [originPattern(origin)] }),
    ),
  );
  return stored.filter((_, index) => granted[index]);
}

export async function removeAddedSite(origin: string): Promise<void> {
  await writeAdded((await readAdded()).filter((stored) => stored !== origin));
  await browser.permissions.remove({ origins: [originPattern(origin)] });
}

export type ToggleOutcome =
  | { kind: "on" }
  | { kind: "off" }
  | { kind: "declined" }
  | { kind: "not-a-site" }
  | { kind: "instance" };

/**
 * Switches the fix on or off for the site in `tab` — what a click on the
 * toolbar icon does.
 *
 * Chrome only shows a permission prompt from inside the click's user gesture,
 * which the first await ends. Whether the site is already on can't be known
 * without one, so the request goes out first regardless: for a site already
 * granted it resolves at once with no prompt, and only then is it decided
 * which way the click goes.
 */
export async function toggleSiteFix(tab: {
  id?: number;
  url?: string;
}): Promise<ToggleOutcome> {
  const origin = tab.url ? toOrigin(tab.url) : null;
  if (!origin || tab.id === undefined) return { kind: "not-a-site" };

  const pattern = originPattern(origin);
  const wasGranted = browser.permissions.contains({ origins: [pattern] });
  const granted = browser.permissions.request({ origins: [pattern] });

  if (!(await granted)) return { kind: "declined" };

  // The instance's own permission is what pairing rests on; the click must
  // never be the thing that takes it away.
  if (origin === (await getInstanceUrl())) return { kind: "instance" };

  const listed = [];
  for (const site of SITES) {
    if (
      site.matches.some((match) => patternCovers(match, origin)) &&
      (await isSiteEnabled(site))
    ) {
      listed.push(site);
    }
  }
  if (listed.length > 0) {
    await Promise.all(listed.map(disableSite));
    return { kind: "off" };
  }

  const added = await readAdded();
  if ((await wasGranted) && added.includes(origin)) {
    await removeAddedSite(origin);
    return { kind: "off" };
  }

  await writeAdded([...new Set([...added, origin])]);
  await syncSiteScripts();
  // Registration only reaches pages loaded from now on; this one gets it now.
  await browser.scripting
    .executeScript({
      target: { tabId: tab.id },
      files: [`/${UNSHIELD_SCRIPT}`],
    })
    .catch(() => {});
  return { kind: "on" };
}

let syncing = Promise.resolve();

/**
 * Brings the registered content script in line with the sites that are on.
 * Serialized, because install, permission and storage events can overlap and
 * a duplicate registration throws.
 */
export function syncSiteScripts(): Promise<void> {
  // Chained on both outcomes, so one failed sync doesn't wedge every later one.
  syncing = syncing.then(sync, sync);
  return syncing;
}

async function sync(): Promise<void> {
  // Added sites whose permission was revoked elsewhere are forgotten, so the
  // options page never lists a site that isn't actually on.
  const stored = await readAdded();
  const added = await getAddedSites();
  if (added.length !== stored.length) await writeAdded(added);

  const matches = added.map(originPattern);
  for (const site of SITES) {
    if (await isSiteEnabled(site)) matches.push(...site.matches);
  }

  const registered = (
    await browser.scripting.getRegisteredContentScripts()
  ).filter((script) => script.id.startsWith(SCRIPT_ID));
  const current = registered.find((script) => script.id === SCRIPT_ID);
  const unchanged =
    registered.length === (matches.length > 0 ? 1 : 0) &&
    (matches.length === 0 || sameSet(current?.matches ?? [], matches));
  if (unchanged) return;

  // Rebuilt rather than updated, which also clears the per-site registrations
  // ("unshield-instagram") that earlier versions made.
  if (registered.length > 0) {
    await browser.scripting.unregisterContentScripts({
      ids: registered.map((script) => script.id),
    });
  }
  if (matches.length > 0) {
    await browser.scripting.registerContentScripts([
      { id: SCRIPT_ID, matches, js: [UNSHIELD_SCRIPT] },
    ]);
  }
}

async function readAdded(): Promise<string[]> {
  const stored = (await browser.storage.local.get(ADDED_KEY))[ADDED_KEY];
  return Array.isArray(stored)
    ? stored.filter((item) => typeof item === "string")
    : [];
}

async function writeAdded(origins: string[]): Promise<void> {
  await browser.storage.local.set({ [ADDED_KEY]: origins });
}

/**
 * Whether a match pattern of the shape the listed sites use —
 * `scheme://host/*`, where scheme may be `*` and host may start `*.` — covers
 * every page on `origin`.
 */
function patternCovers(pattern: string, origin: string): boolean {
  const parsed = /^(\*|https?):\/\/([^/]+)\/\*$/.exec(pattern);
  if (!parsed) return false;
  const [, scheme, host = ""] = parsed;
  const url = new URL(origin);

  if (scheme !== "*" && `${scheme}:` !== url.protocol) return false;
  if (host === "*") return true;
  if (host.startsWith("*.")) {
    const base = host.slice(2);
    return url.hostname === base || url.hostname.endsWith(`.${base}`);
  }
  return url.host === host;
}

function sameSet(a: string[], b: string[]): boolean {
  const left = new Set(a);
  return left.size === new Set(b).size && b.every((item) => left.has(item));
}
