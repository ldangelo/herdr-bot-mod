// A client for the herdr-bot host's app API over a loopback WebSocket (protocol: core/src/ws/server.ts).
// Pure logic with injected connect/sleep, so it runs under Node tests and inside herdr-app alike.

export class AppApiClient {
  /**
   * @param {{ connect: (url: string) => Promise<{ read(): Promise<string | Uint8Array>, write(data: string): Promise<void>, close(): Promise<void> | void }>,
   *           sleep: (ms: number) => Promise<void>, onEvent?: (event: any) => void, requestTimeoutMs?: number }} deps
   */
  constructor({ connect, sleep, onEvent = () => {}, requestTimeoutMs = 15000 }) {
    this.connect = connect;
    this.sleep = sleep;
    this.onEvent = onEvent;
    this.requestTimeoutMs = requestTimeoutMs;
    this.socket = null;
    /** The host's version from its `ready` message; null from a host that predates versions. */
    this.hostVersion = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  get isOpen() {
    return this.socket != null;
  }

  /** Connects and authenticates; throws if the host refuses (a wrong token closes the socket). */
  async open(endpoint) {
    const socket = await this.connect(`ws://127.0.0.1:${endpoint.port}/`);
    try {
      await socket.write(JSON.stringify({ op: "auth", token: endpoint.token }));
      const first = await socket.read();
      const message = typeof first === "string" ? JSON.parse(first) : null;
      if (message?.op !== "ready") throw new Error("the host did not accept the connection");
      this.hostVersion = typeof message.version === "string" ? message.version : null;
    } catch (error) {
      try { await socket.close(); } catch { /* already gone */ }
      throw error;
    }
    this.socket = socket;
  }

  /** Reads messages until the connection ends. Run it inside one task: it is the only reader. */
  async pump() {
    const socket = this.socket;
    while (socket != null && this.socket === socket) {
      let data;
      try {
        data = await socket.read();
      } catch {
        break;
      }
      if (typeof data !== "string") continue;
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        continue;
      }
      if (message?.op === "event") this.onEvent(message.event);
      else if (message != null && "id" in message) this.#settle(message);
    }
    if (this.socket === socket) this.socket = null;
    this.#rejectAll(new Error("disconnected"));
  }

  /** Resolves with the method's result; rejects with an Error carrying `.code` for an API error. Creating a bot waits on the agent starting, so it passes a longer `timeoutMs`. */
  async request(method, params = {}, timeoutMs = this.requestTimeoutMs) {
    const socket = this.socket;
    if (socket == null) throw new Error("not connected");
    const id = this.nextId++;
    const answer = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    try {
      await socket.write(JSON.stringify({ id, method, params }));
    } catch (error) {
      this.pending.delete(id);
      throw error;
    }
    const timeout = this.sleep(timeoutMs).then(() => {
      if (this.pending.delete(id)) throw new Error(`${method} timed out`);
      return new Promise(() => {});
    });
    return Promise.race([answer, timeout]);
  }

  async close() {
    const socket = this.socket;
    this.socket = null;
    this.#rejectAll(new Error("closed"));
    if (socket != null) {
      try { await socket.close(); } catch { /* already gone */ }
    }
  }

  #settle(message) {
    const entry = this.pending.get(message.id);
    if (entry == null) return;
    this.pending.delete(message.id);
    if (message.error != null) {
      const error = new Error(message.error.message ?? "request failed");
      error.code = message.error.code;
      entry.reject(error);
    } else {
      entry.resolve(message.result);
    }
  }

  #rejectAll(error) {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
}
