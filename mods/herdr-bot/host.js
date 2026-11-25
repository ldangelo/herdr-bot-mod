// Finding the herdr-bot host, starting it when it is not running, and connecting. Pure: every effect is injected.

export class HostMissingError extends Error {
  constructor(message) {
    super(message);
    this.name = "HostMissingError";
  }
}

/** The host that answered is older than this mod needs (or a different major): it must be updated, not used. */
export class HostOutdatedError extends Error {
  constructor(message, hostVersion) {
    super(message);
    this.name = "HostOutdatedError";
    this.hostVersion = hostVersion;
  }
}

/**
 * @param {{ readEndpoint: () => Promise<{port:number, token:string} | null>,
 *           startHost: () => Promise<void>,
 *           connect: (endpoint: {port:number, token:string}) => Promise<any>,
 *           sleep: (ms:number) => Promise<void>, now: () => number,
 *           onPhase?: (phase: "connecting" | "starting") => void,
 *           timeoutMs?: number, pollMs?: number }} deps
 * A leftover endpoint file from a crashed host just fails to connect, which is treated like "not running".
 */
export async function connectToHost({ readEndpoint, startHost, connect, sleep, now, onPhase = () => {}, timeoutMs = 25000, pollMs = 500 }) {
  onPhase("connecting");
  const deadline = now() + timeoutMs;
  let started = false;
  let lastError = null;
  for (;;) {
    const endpoint = await readEndpoint();
    if (endpoint != null) {
      try {
        return await connect(endpoint);
      } catch (error) {
        lastError = error;
      }
    }
    if (!started) {
      started = true;
      onPhase("starting");
      await startHost();
    }
    if (now() >= deadline) throw new Error(`the herdr-bot host did not come up (${lastError?.message ?? "no endpoint published"})`);
    await sleep(pollMs);
  }
}

/** The argv for `hc` that starts the host as a terminal that outlives the app but stops itself when the app is gone. */
export function hostLaunchArgs({ botHome, shimPath, idleSeconds = 30 }) {
  return ["run", "--bg", "--json", "--name", "herdr-bot-host", "--no-parent", "--outlive-parent", "--no-notify", "--",
    "env", `HERDR_BOT_HOME=${botHome}`, shimPath, "serve", "--runtime", "hc", "--exit-when-idle", String(idleSeconds)];
}

/** `hc run --name` refuses a name a live terminal already holds (kind "name_taken"): then a host is already starting. */
export function isHostAlreadyStarting(result) {
  return result.code !== 0 && /"kind"\s*:\s*"name_taken"/.test(`${result.stderr}${result.stdout}`);
}
