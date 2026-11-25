// Which host this mod works with, and how to tell whether the one that is running is new enough. Pure.
//
// REQUIRED_HOST_VERSION is what this mod was released against; the host sends its own version when a client
// connects (core/src/version.ts), and anything older than this, or a different major, gets an update prompt instead
// of half-working. mod/test/version.test.js fails if this drifts from package.json, so bump them together.

export const REQUIRED_HOST_VERSION = "1.3.0";

/**
 * Releases are tagged `host-v<version>` and downloaded by exact tag, never `releases/latest`: "latest" means the newest
 * release of any kind in the repository, which a future desktop-app release would take over.
 */
export const RELEASES_BASE = "https://github.com/ldangelo/herdr-app-bot/releases/download";

export function sourceForVersion(version, base = RELEASES_BASE) {
  return `${base}/host-v${version}`;
}

/** "1.4.2" -> [1, 4, 2]; anything else (including a prerelease suffix) -> null. */
export function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? "").trim());
  return match == null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative, zero or positive like a comparator; null when either side is not a plain version. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left == null || right == null) return null;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Is the running host usable by this mod: the same major, and at least as new as required. A host that sends no version
 * is one from before versions existed, which is by definition too old.
 */
export function isHostCurrent(hostVersion, required = REQUIRED_HOST_VERSION) {
  const have = parseVersion(hostVersion);
  const need = parseVersion(required);
  if (have == null || need == null) return false;
  return have[0] === need[0] && compareVersions(hostVersion, required) >= 0;
}

/** One line for the update prompt. */
export function describeVersionGap(hostVersion, required = REQUIRED_HOST_VERSION) {
  if (parseVersion(hostVersion) == null) return `The running herdr-bot host is too old to say which version it is. This mod needs ${required}.`;
  const have = parseVersion(hostVersion);
  const need = parseVersion(required);
  if (have[0] > need[0]) return `The running herdr-bot host (${hostVersion}) is a newer major version than this mod understands (${required}). Update the herdr-bot mod.`;
  return `The running herdr-bot host (${hostVersion}) is older than this mod needs (${required}).`;
}
