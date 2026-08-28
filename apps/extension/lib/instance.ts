/** Where the paired instance URL lives, and how we ask for access to it. */

const STORAGE_KEY = "instanceUrl";

/** Normalizes to a bare origin — trailing paths would break endpoint joins. */
export function toOrigin(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function getInstanceUrl(): Promise<string | null> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY];
  return typeof value === "string" ? value : null;
}

export async function setInstanceUrl(origin: string): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: origin });
}

/** Match pattern covering every path on the instance origin. */
export function originPattern(origin: string): string {
  return `${origin}/*`;
}

export function hasPermission(origin: string): Promise<boolean> {
  return browser.permissions.contains({ origins: [originPattern(origin)] });
}

/**
 * Must be called from a user gesture (a click), per Chrome's rules for
 * optional permission prompts — which is why pairing lives behind a button.
 */
export function requestPermission(origin: string): Promise<boolean> {
  return browser.permissions.request({ origins: [originPattern(origin)] });
}
