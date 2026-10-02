/**
 * Sites that hide their images behind overlays, and the opt-in fix for each.
 *
 * Switching a site on is nothing more than granting its host permission; the
 * background worker notices and registers the unshield content script for it.
 * The permission is the single source of truth, so revoking it from
 * chrome://extensions switches the site off just the same.
 */

export type Site = {
  id: string;
  name: string;
  matches: string[];
};

export const SITES: Site[] = [
  { id: "instagram", name: "Instagram", matches: ["*://*.instagram.com/*"] },
];

/** Bundle path WXT gives entrypoints/unshield.content.ts. */
const UNSHIELD_SCRIPT = "content-scripts/unshield.js";

function scriptId(site: Site): string {
  return `unshield-${site.id}`;
}

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

let syncing = Promise.resolve();

/**
 * Brings registered content scripts in line with granted permissions.
 * Serialized, because install and permission events can overlap and a
 * duplicate registration throws.
 */
export function syncSiteScripts(): Promise<void> {
  // Chained on both outcomes, so one failed sync doesn't wedge every later one.
  syncing = syncing.then(sync, sync);
  return syncing;
}

async function sync(): Promise<void> {
  const registered = new Set(
    (await browser.scripting.getRegisteredContentScripts()).map((script) => script.id),
  );

  for (const site of SITES) {
    const id = scriptId(site);
    const enabled = await isSiteEnabled(site);

    if (enabled && !registered.has(id)) {
      await browser.scripting.registerContentScripts([
        { id, matches: site.matches, js: [UNSHIELD_SCRIPT] },
      ]);
    } else if (!enabled && registered.has(id)) {
      await browser.scripting.unregisterContentScripts({ ids: [id] });
    }
  }
}
