// Fetching the herdr-bot host for a machine that does not have it. Pure: every effect (fetching the manifest, running
// curl and shasum, ...) is injected, so this runs under Node tests and inside herdr-app alike.
//
// Trust: running a downloaded program is a decision for the person, so the caller asks first; only https (or a loopback
// address, for development) is accepted; and the file must match the SHA-256 in the manifest. The manifest comes from the
// same place as the binary, so the checksum guards against a damaged or truncated download, not against a compromised
// source: the source itself is what is trusted.

import { REQUIRED_HOST_VERSION, sourceForVersion } from "./version.js";

/** Where the host this mod needs is published: the release for exactly that version. */
export const DEFAULT_SOURCE = sourceForVersion(REQUIRED_HOST_VERSION);

export class HostUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "HostUnavailableError";
  }
}

/** Operating-system names as Node, Rust (herdr-app's `os` module) and herdr itself spell them, as manifest keys use them. */
export function normalizePlatform(platform) {
  const word = String(platform).toLowerCase();
  if (word === "macos" || word === "darwin") return "darwin";
  if (word === "windows" || word === "win32") return "windows";
  return word;
}

/** CPU names likewise: herdr-app reports Rust's "aarch64"/"x86_64", Node says "arm64"/"x64". */
export function normalizeArch(arch) {
  const word = String(arch).toLowerCase();
  if (word === "aarch64" || word === "arm64") return "arm64";
  if (word === "x86_64" || word === "amd64" || word === "x64") return "x64";
  return word;
}

/** The manifest/asset key for this machine ("darwin-arm64"). */
export function platformKey(platform, arch) {
  return `${normalizePlatform(platform)}-${normalizeArch(arch)}`;
}

/** Only https, or plain http to this machine (a local test server), may serve a program we will run. */
export function isAllowedSource(source) {
  let url;
  try {
    url = new URL(source);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
}

function isLoopback(source) {
  return new URL(source).protocol === "http:";
}

/** Picks this machine's asset from a manifest, validating its shape. Throws HostUnavailableError when there is none. */
export function pickAsset(manifest, key) {
  const asset = manifest?.assets?.[key];
  if (asset == null) throw new HostUnavailableError(`there is no herdr-bot host build for ${key} yet`);
  if (typeof asset.file !== "string" || !/^[A-Za-z0-9._-]+$/.test(asset.file)) throw new HostUnavailableError("the host manifest names an unsafe file");
  if (typeof asset.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw new HostUnavailableError("the host manifest has no valid checksum");
  return asset;
}

/** Whether the download is big enough to say so up front. */
export function describeSize(bytes) {
  return typeof bytes === "number" && bytes > 0 ? `${Math.round(bytes / (1024 * 1024))} MB` : "a large file";
}

/**
 * What an install would fetch, found without downloading the program: shown to the person before they agree.
 * @returns {Promise<{ ok: true, version: string, size: number | null, key: string } | { ok: false, reason: string }>}
 */
export async function planInstall({ source, platform, arch, fetchText }) {
  if (!isAllowedSource(source)) return { ok: false, reason: `${source} is not an https address` };
  if (normalizePlatform(platform) === "windows") return { ok: false, reason: "installing the host is not supported on Windows yet" };
  const key = platformKey(platform, arch);
  try {
    const manifest = JSON.parse(await fetchText(`${source.replace(/\/+$/, "")}/manifest.json`));
    const asset = pickAsset(manifest, key);
    return { ok: true, version: String(manifest.version ?? ""), size: typeof asset.size === "number" ? asset.size : null, key };
  } catch (error) {
    return { ok: false, reason: error instanceof HostUnavailableError ? error.message : `could not reach ${source} (${error.message})` };
  }
}

/**
 * @param {{ source: string, botHome: string, platform: string, arch: string,
 *           fetchText: (url: string) => Promise<string>,
 *           exec: (command: string, args: string[]) => Promise<{ code: number, stdout: string, stderr: string }>,
 *           onStep?: (step: "manifest" | "download" | "verify" | "install") => void }} deps
 * @returns {Promise<{ path: string, version: string, sha256: string }>}
 */
export async function installHost({ source, botHome, platform, arch, fetchText, exec, onStep = () => {} }) {
  if (!isAllowedSource(source)) throw new HostUnavailableError(`${source} is not an https address`);
  const base = source.replace(/\/+$/, "");
  const key = platformKey(platform, arch);
  if (normalizePlatform(platform) === "windows") throw new HostUnavailableError("installing the host is not supported on Windows yet");

  onStep("manifest");
  let manifest;
  try {
    manifest = JSON.parse(await fetchText(`${base}/manifest.json`));
  } catch (error) {
    throw new HostUnavailableError(`could not read the host manifest from ${base} (${error.message})`);
  }
  const asset = pickAsset(manifest, key);

  const bin = `${botHome}/bin`;
  const partial = `${bin}/.herdr-bot.download`;
  const final = `${bin}/herdr-bot`;
  const run = async (command, args) => {
    const result = await exec(command, args);
    if (result.code !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout).trim().slice(0, 200)}`);
    return result;
  };
  const discard = () => exec("rm", ["-f", partial]).catch(() => {});

  await run("mkdir", ["-p", bin]);
  onStep("download");
  try {
    await run("curl", ["-fL", "--silent", "--show-error", ...(isLoopback(base) ? [] : ["--proto", "=https", "--proto-redir", "=https"]), "--max-time", "900", "-o", partial, `${base}/${asset.file}`]);
    onStep("verify");
    const sum = await run("shasum", ["-a", "256", partial]);
    const actual = sum.stdout.trim().split(/\s+/)[0]?.toLowerCase();
    if (actual !== asset.sha256) throw new HostUnavailableError(`the download is damaged (checksum ${String(actual).slice(0, 12)}… does not match ${asset.sha256.slice(0, 12)}…)`);
    onStep("install");
    await run("chmod", ["755", partial]);
    await run("mv", ["-f", partial, final]);
  } catch (error) {
    await discard();
    throw error;
  }
  return { path: final, version: String(manifest.version ?? ""), sha256: asset.sha256 };
}
