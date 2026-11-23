import { APP_VERSION } from "./version";

export type AvailableUpdate = { version: string; url: string };

const RELEASES_URL = "https://api.github.com/repos/FrancescoBia/substratum/releases/latest";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

let cached: { result: AvailableUpdate | null; expiresAt: number } | null = null;
let inFlight: Promise<AvailableUpdate | null> | null = null;

/**
 * The newest published release, if it is newer than the running version.
 * Cached for hours and shared between requests; a failure only means no badge
 * until the next attempt.
 */
export async function getAvailableUpdate(): Promise<AvailableUpdate | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  inFlight ??= fetchLatestRelease()
    .then((latest) => {
      const result = latest && isNewerVersion(latest.version, APP_VERSION) ? latest : null;
      cached = { result, expiresAt: Date.now() + CHECK_INTERVAL_MS };
      return result;
    })
    .catch(() => {
      cached = { result: null, expiresAt: Date.now() + RETRY_INTERVAL_MS };
      return null;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

async function fetchLatestRelease(): Promise<AvailableUpdate | null> {
  const response = await fetch(RELEASES_URL, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "substratum" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);

  const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
  if (typeof release.tag_name !== "string" || typeof release.html_url !== "string") return null;
  if (!release.html_url.startsWith("https://github.com/")) return null;

  return { version: release.tag_name.replace(/^v/, ""), url: release.html_url };
}

/** Compares `x.y.z` versions. A pre-release suffix never counts as newer. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (version: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
    return match ? match.slice(1).map(Number) : null;
  };
  const a = parse(candidate);
  const [core, preRelease] = current.trim().split(/-(.*)/);
  const b = parse(core);
  if (!a || !b) return false;

  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return Boolean(preRelease);
}
