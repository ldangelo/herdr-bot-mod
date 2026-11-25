// herdr-bot for herdr-app: chat with your agents and let them talk to each other.
// The UI lives here; the host (turn-taking, transcripts, agents via hc) runs as `herdr-bot serve` and is
// reached over a loopback WebSocket. See client.js, host.js, state.js and transcript.js for the logic.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, TextareaState, Textarea } from "gpui-base";
import { appHome, checking, exec, hc, home, props, readTextFile, theme } from "herdr";
import { arch, platform } from "os";
import { WebSocket } from "websocket";
import { AppApiClient } from "./client.js";
import { HostMissingError, HostOutdatedError, connectToHost, hostLaunchArgs, isHostAlreadyStarting } from "./host.js";
import { DEFAULT_SOURCE, describeSize, installHost, planInstall } from "./install.js";
import { describeVersionGap, isHostCurrent } from "./version.js";
import { applyEvent, statusOf, summarize, visibleChats } from "./state.js";
import { NewBot } from "./newbot.js";
import { applyTranscriptEvent, isOneClickPrompt, isSeqGap, lastSeq, mergeEntries, visibleEntries } from "./transcript.js";

const MAX_BACKOFF_MS = 10000;
const PAGE_SIZE = 200;

/**
 * `<appHome>/herdr-bot.json`: {"home": "..."} overrides ~/.herdr-bot (where the host keeps its files) and
 * {"hostSource": "https://..."} overrides where the host program is downloaded from.
 */
async function loadConfig() {
  const config = { botHome: `${home()}/.herdr-bot`, source: DEFAULT_SOURCE };
  try {
    const raw = await readTextFile(`${appHome()}/herdr-bot.json`);
    const parsed = raw == null ? {} : JSON.parse(raw);
    if (typeof parsed.home === "string" && parsed.home.length > 0) config.botHome = parsed.home;
    if (typeof parsed.hostSource === "string" && parsed.hostSource.length > 0) config.source = parsed.hostSource;
  } catch {
    // an unreadable override is the same as none
  }
  return config;
}

const fetchText = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
};

/**
 * Whether the host program is there and runnable. Not readTextFile: the host is a binary, which that refuses (it reads
 * UTF-8 text up to 1 MiB), while a text shim from an older install would pass.
 */
const isRunnable = async (path) => (await exec("test", ["-x", path])).code === 0;

/** curl may be fetching tens of megabytes; everything else is quick. */
const run = (command, args) => exec(command, args, { timeout: command === "curl" ? 600000 : 60000 });

async function readEndpoint(botHome) {
  try {
    const raw = await readTextFile(`${botHome}/ws.json`);
    const parsed = raw == null ? null : JSON.parse(raw);
    return parsed != null && typeof parsed.port === "number" && typeof parsed.token === "string" ? parsed : null;
  } catch {
    return null;
  }
}

async function startHost(botHome) {
  const shimPath = `${botHome}/bin/herdr-bot`;
  if (!(await isRunnable(shimPath))) throw new HostMissingError(`herdr-bot is not installed: ${shimPath} is missing`);
  const result = await hc(hostLaunchArgs({ botHome, shimPath }));
  if (result.code !== 0 && !isHostAlreadyStarting(result)) throw new Error(`could not start the herdr-bot host: ${(result.stderr || result.stdout).trim().slice(0, 200)}`);
}

const PHASE_TEXT = {
  connecting: "Connecting to herdr-bot…",
  starting: "Starting the herdr-bot host…",
  disconnected: "Lost the host. Reconnecting…",
  installing: "Installing the herdr-bot host…",
  outdated: "The herdr-bot host needs updating.",
};

const INSTALL_STEPS = { manifest: "Checking what to download…", download: "Downloading the herdr-bot host…", verify: "Verifying the download…", install: "Installing…" };

export default class HerdrBot extends View {
  // Not named `props`: that would shadow the imported props() below.
  init(_props, cx) {
    this.phase = "connecting";
    this.error = null;
    this.chats = [];
    this.client = null;
    this.alive = true;
    this.retryRequested = false;
    this.installRequested = props()?.installHost === true; // pre-approved by whoever laid this tab out
    this.installPlan = null;
    this.installStep = null;
    this.installError = null; // survives reconnect attempts, which reset `error`
    this.outdated = null; // { have, gap } while the running host is older than this mod needs
    this.updatedOnce = false;
    this.lastEventSeq = null;
    // The open chat, if any: its entries, and what the composer and scroll position are doing.
    // `props.chat` opens straight into that chat (a tab or palette entry can ask for one).
    this.selected = typeof props()?.chat === "string" && props().chat.length > 0 ? props().chat : null;
    this.entries = [];
    this.loading = false;
    this.sending = false;
    this.sendError = null;
    this.scrollToEnd = false;
    this.scroll = ScrollHandle.new();
    // "list" (or the open chat), or the new-bot screen.
    this.screen = "list";
    // `props.screen: "new-bot"` opens that screen once connected (a palette entry or tab can ask for it).
    this.startScreen = props()?.screen === "new-bot" ? "new-bot" : null;
    this.newBot = new NewBot({
      client: () => this.client,
      button: (t, id, label, primary, onClick, disabled) => this.button(t, id, label, primary, onClick, disabled),
      onDone: (chatId, cx) => {
        this.screen = "list";
        this.openChat(chatId, cx);
      },
      onCancel: (cx) => {
        this.screen = "list";
        cx.notify();
      },
    });
    this.input = TextareaState.new({ placeholder: "Message", rows: 2 });
    this.input.set_auto_grow(2, 8);
    this.input.on("change", (_event, cx) => {
      this.sendError = null;
      cx.notify();
    });
    this.input.on("submit", (_event, cx) => this.send(cx));
    // `herdr-app check` runs init() for real: start nothing there.
    if (checking()) return;
    cx.spawn(async (cx) => this.lifecycle(cx));
  }

  async close() {
    this.alive = false;
    // The host stops itself shortly after the last client leaves, so there is nothing else to clean up.
    await this.client?.close();
  }

  // ---- connection -------------------------------------------------------------------------------

  async lifecycle(cx) {
    const { botHome, source } = await loadConfig();
    this.source = source;
    let backoff = 1000;
    while (this.alive) {
      let fatal = false;
      let outdated = false;
      try {
        this.phase = "connecting";
        this.error = null;
        cx.notify();
        const client = await connectToHost({
          readEndpoint: () => readEndpoint(botHome),
          startHost: () => startHost(botHome),
          connect: async (endpoint) => {
            const next = new AppApiClient({
              connect: (url) => WebSocket.connect(url),
              sleep: (ms) => cx.sleep(ms),
              onEvent: (event) => this.onEvent(event, cx),
            });
            await next.open(endpoint);
            return next;
          },
          sleep: (ms) => cx.sleep(ms),
          now: () => Date.now(),
          onPhase: (phase) => {
            this.phase = phase;
            cx.notify();
          },
        });
        // The host says which version it is when we connect: an older one gets an update prompt, not half-working screens.
        if (!isHostCurrent(client.hostVersion)) {
          await client.close();
          throw new HostOutdatedError(describeVersionGap(client.hostVersion), client.hostVersion);
        }
        this.outdated = null;
        this.client = client;
        this.lastEventSeq = null;
        backoff = 1000;
        const pump = client.pump();
        await this.resync(cx);
        this.phase = "ready";
        if (this.startScreen === "new-bot") {
          this.startScreen = null;
          this.openNewBot(cx);
        }
        cx.notify();
        await pump;
        this.phase = "disconnected";
      } catch (error) {
        outdated = error instanceof HostOutdatedError && !this.updatedOnce;
        fatal = error instanceof HostMissingError || outdated;
        this.error = String((error && error.message) || error);
        if (error instanceof HostOutdatedError) {
          this.outdated = { have: error.hostVersion, gap: error.message };
          // Already updated once and still old: a different host process is answering. Say so instead of asking again.
          if (this.updatedOnce) this.error = `${error.message} It is still old after updating: another herdr-bot host may be running. Stop it and reopen this view.`;
        }
        this.phase = outdated ? "outdated" : fatal ? "missing" : "error";
      }
      this.client = null;
      cx.notify();
      if (fatal) {
        // The host program is not here. Say what a download would be, then wait to be told to go ahead (or to look again).
        this.installPlan = await planInstall({ source, platform: platform(), arch: arch(), fetchText }).catch((error) => ({ ok: false, reason: String(error.message ?? error) }));
        cx.notify();
        this.retryRequested = false;
        // A missing host also stops the wait if it appears some other way (another copy of this mod installed it); an
        // outdated one is there already, so it waits only for the person.
        while (this.alive && !this.retryRequested && !this.installRequested && (outdated || !(await isRunnable(`${botHome}/bin/herdr-bot`)))) await cx.sleep(300);
        if (this.alive && this.installRequested && this.installPlan.ok) {
          this.installRequested = false;
          this.phase = "installing";
          this.installError = null;
          this.installStep = INSTALL_STEPS.manifest;
          cx.notify();
          try {
            await installHost({ source, botHome, platform: platform(), arch: arch(), fetchText, exec: run, onStep: (step) => { this.installStep = INSTALL_STEPS[step]; cx.notify(); } });
            if (outdated) {
              // The old host still runs the old program in memory: stop it (the bots keep running) so the next connect starts the new one.
              this.updatedOnce = true;
              await hc(["kill", "herdr-bot-host"]).catch(() => {});
              await hc(["rm", "herdr-bot-host"]).catch(() => {});
            }
          } catch (error) {
            this.installError = String((error && error.message) || error);
            this.phase = outdated ? "outdated" : "missing";
          }
          this.installStep = null;
        }
        this.installRequested = false;
      } else {
        await cx.sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }

  /** Fetches the chat list and the open chat afresh: on connect, and whenever an event may have been missed. */
  async resync(cx) {
    this.chats = await this.client.request("chat.list");
    if (this.selected != null) await this.loadTranscript(this.selected, cx, { replace: true });
    cx.notify();
  }

  onEvent(event, cx) {
    const gap = isSeqGap(this.lastEventSeq, event.seq);
    this.lastEventSeq = event.seq;
    this.chats = applyEvent(this.chats, event);
    if (this.selected != null) {
      const before = this.entries;
      this.entries = applyTranscriptEvent(this.entries, this.selected, event);
      if (this.entries !== before && event.type === "transcript.entryAppended") {
        this.scrollToEnd = true;
        this.markRead(cx);
      }
    }
    // The unread flag arrives on a chat.changed that can follow the entry itself: read it again then.
    if (this.selected != null && event.type === "chat.changed" && event.payload?.id === this.selected && event.payload.hasUnread) this.markRead(cx);
    if (gap && this.client != null) cx.spawn(async (cx) => this.resync(cx).catch(() => {}));
    cx.notify();
  }

  // ---- the open chat ----------------------------------------------------------------------------

  openChat(id, cx) {
    this.selected = id;
    this.entries = [];
    this.sendError = null;
    this.input.set_value("");
    cx.spawn(async (cx) => {
      try {
        await this.loadTranscript(id, cx, { replace: true });
        this.input.focus();
      } catch (error) {
        this.sendError = String((error && error.message) || error);
      }
      cx.notify();
    });
    cx.notify();
  }

  openNewBot(cx) {
    this.screen = "new-bot";
    this.newBot.open(cx);
  }

  closeChat(cx) {
    this.selected = null;
    this.entries = [];
    this.sendError = null;
    cx.notify();
  }

  async loadTranscript(id, cx, { replace }) {
    this.loading = true;
    cx.notify();
    try {
      const page = await this.client.request("transcript.page", { chatId: id, limit: PAGE_SIZE });
      if (this.selected !== id) return; // the person moved on while it loaded
      this.entries = replace ? mergeEntries([], page.entries) : mergeEntries(this.entries, page.entries);
      this.scrollToEnd = true;
      this.markRead(cx);
    } finally {
      this.loading = false;
    }
  }

  /** Clears the unread badge once the newest entry is on screen. */
  markRead(cx) {
    const chat = this.chats.find((candidate) => candidate.id === this.selected);
    const seq = lastSeq(this.entries);
    if (chat == null || !chat.hasUnread || seq === 0 || this.client == null) return;
    this.client.request("chat.markRead", { chatId: chat.id, throughSeq: seq }).catch(() => {});
  }

  send(cx) {
    const text = this.input.value().trim();
    if (this.selected == null || text.length === 0 || this.sending || this.client == null) return;
    const chatId = this.selected;
    this.sending = true;
    this.sendError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.client.request("message.send", { chatId, text });
        this.input.set_value("");
        this.scrollToEnd = true;
      } catch (error) {
        this.sendError = String((error && error.message) || error);
      }
      this.sending = false;
      cx.notify();
    });
  }

  answer(view, option, cx) {
    if (this.client == null || this.selected == null) return;
    this.sendError = null;
    cx.spawn(async (cx) => {
      try {
        await this.client.request("prompt.answer", { botId: this.selected, signature: view.prompt.signature, action: "option", key: option.key });
      } catch (error) {
        this.sendError = String((error && error.message) || error);
      }
      cx.notify();
    });
  }

  // ---- drawing ----------------------------------------------------------------------------------

  mark(t, status) {
    if (status === "blocked") {
      return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    }
    if (status === "working") return div().size(8).mx(3).flex_none().rounded(4).bg(t.working).loop("opacity", { from: 0.35, to: 1, period: 1100 });
    if (status === "idle") return div().size(8).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    if (status === "done") return div().size(8).mx(3).flex_none().rounded(4).bg(t.done);
    return div().size(8).mx(3).flex_none().rounded(4).bg(t.dim + "66");
  }

  avatar(t, chat, size) {
    return div().size(size).flex_none().rounded(size / 2).bg(t.raised).flex().items_center().justify_center().text_size(size * 0.43).font_semibold().text_color(t.foreground).child((chat.name || "?").slice(0, 1).toUpperCase());
  }

  row(t, chat) {
    return h_flex()
      .id(`chat-${chat.id}`)
      .px(10)
      .py(8)
      .gap(10)
      .rounded(8)
      .flex_none()
      .items_center()
      .cursor_pointer()
      .hover((el) => el.bg(t.hover))
      .on_click((_event, cx) => this.openChat(chat.id, cx))
      .child(this.avatar(t, chat, 30))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(1)
          .child(div().truncate().text_size(13).font_semibold().text_color(t.foreground).child(chat.name))
          .child(div().truncate().text_size(11.5).text_color(t.muted).child(chat.lastMessagePreview || (chat.kind === "room" ? "Room" : chat.bot?.provider ?? "Bot"))),
      )
      .when(chat.unreadCount > 0, (el) => el.child(div().flex_none().min_w(18).h(18).px(5).rounded(9).bg(t.accent).text_size(10.5).font_semibold().text_color(t.accent_foreground).flex().items_center().justify_center().child(String(chat.unreadCount))))
      .child(this.mark(t, statusOf(chat)));
  }

  notice(t, text, detail, action, onAction) {
    return v_flex()
      .flex_1()
      .items_center()
      .justify_center()
      .gap(8)
      .px(24)
      .child(div().text_size(13).text_color(t.foreground).child(text))
      .when(Boolean(detail), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(detail)))
      .when(Boolean(action), (el) => el.child(this.button(t, "notice-action", action, true, onAction)));
  }

  /** The host program is missing, or too old: say what a download is, and let the person decide. */
  missingView(t) {
    const plan = this.installPlan;
    const outdated = this.phase === "outdated";
    const heading = outdated ? "The herdr-bot host needs updating" : "herdr-bot needs its host program";
    const again = (_event, cx) => {
      this.retryRequested = true;
      cx.notify();
    };
    if (plan == null) return this.notice(t, heading, "Checking where to get it…");
    if (!plan.ok) return this.notice(t, outdated ? heading : "herdr-bot cannot be installed here", plan.reason, "Check again", again);
    const where = (() => { try { return new URL(this.source).host; } catch { return this.source; } })();
    const lead = `Download ${describeSize(plan.size)} from ${where}${plan.version ? ` (version ${plan.version})` : ""}. It is checked against its checksum, then run on this computer.`;
    return this.notice(
      t,
      heading,
      this.installError ?? (outdated ? `${this.outdated?.gap ?? ""} ${lead}`.trim() : lead),
      this.installError ? "Try again" : outdated ? "Update" : "Download",
      (_event, cx) => {
        this.installRequested = true;
        this.installError = null;
        cx.notify();
      },
    );
  }

  button(t, id, label, primary, onClick, disabled = false) {
    return div()
      .id(id)
      .px(12)
      .h(28)
      .flex_none()
      .rounded(7)
      .when(primary, (el) => el.bg(disabled ? t.raised : t.solid).text_color(disabled ? t.dim : t.solid_foreground))
      .when(!primary, (el) => el.bg(t.raised).text_color(t.foreground).hover((hover) => hover.bg(t.hover)))
      .text_size(12)
      .font_semibold()
      .flex()
      .items_center()
      .when(!disabled, (el) => el.cursor_pointer().on_click(onClick))
      .child(label);
  }

  /** Message text, one line per newline so paragraphs survive. */
  body(t, text, color) {
    return v_flex().gap(2).children(text.split("\n").map((line) => div().text_size(13).text_color(color).child(line.length > 0 ? line : " ")));
  }

  card(t, view, chat) {
    const answerable = isOneClickPrompt(view);
    return v_flex()
      .gap(8)
      .p(10)
      .rounded(10)
      .border(1)
      .border_color(answerable ? t.blocked + "66" : t.border)
      .bg(t.raised)
      .child(div().text_size(10.5).font_semibold().text_color(answerable ? t.blocked : t.dim).child(answerable ? "NEEDS YOU" : String(view.status).toUpperCase()))
      .when(Boolean(view.prompt?.title), (el) => el.child(div().text_size(12).font_semibold().text_color(t.foreground).child(view.prompt.title)))
      .child(this.body(t, view.text, t.foreground))
      .when(Boolean(view.prompt?.body?.length), (el) => el.child(this.body(t, view.prompt.body.join("\n"), t.muted)))
      .when(answerable, (el) => el.child(v_flex().gap(4).children(view.prompt.options.map((option) => this.button(t, `answer-${view.id}-${option.key}`, `${option.key}. ${option.label}`, false, (_event, cx) => this.answer(view, option, cx))))))
      .when(view.status === "pending" && !answerable, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(`This one needs typing or several choices: answer it in ${chat?.name ?? "the bot"}'s terminal.`)));
  }

  message(t, view, chat) {
    if (view.role === "notice") return div().px(8).text_size(11.5).text_color(t.dim).child(view.text);
    if (view.role === "prompt") return this.card(t, view, chat);
    const mine = view.role === "user";
    return v_flex()
      .gap(2)
      .when(mine, (el) => el.items_end())
      .when(!mine, (el) => el.items_start())
      .when(!mine && Boolean(view.author), (el) => el.child(div().px(4).text_size(11).font_semibold().text_color(t.muted).child(view.author)))
      .child(
        div()
          .max_w(280)
          .px(10)
          .py(7)
          .rounded(10)
          .bg(mine ? t.selected : t.raised)
          .child(this.body(t, view.text, t.foreground)),
      );
  }

  chatView(t) {
    const chat = this.chats.find((candidate) => candidate.id === this.selected) ?? { id: this.selected, name: this.selected, kind: "bot", bot: null };
    const views = visibleEntries(this.entries);
    if (this.scrollToEnd && views.length > 0) {
      this.scroll.scroll_to_item(views.length - 1);
      this.scrollToEnd = false;
    }
    const empty = this.input.value().trim().length === 0;
    return v_flex()
      .flex_1()
      .min_h(0)
      .child(
        h_flex()
          .h(44)
          .px(10)
          .flex_none()
          .items_center()
          .gap(8)
          .border_b(1)
          .border_color(t.border)
          .child(div().id("back").px(8).h(26).rounded(6).flex().items_center().cursor_pointer().text_size(14).text_color(t.muted).hover((el) => el.bg(t.hover)).on_click((_event, cx) => this.closeChat(cx)).child("‹"))
          .child(this.avatar(t, chat, 24))
          .child(div().flex_1().truncate().text_size(13).font_semibold().child(chat.name))
          .child(this.mark(t, statusOf(chat))),
      )
      .child(
        views.length === 0
          ? this.notice(t, this.loading ? "Loading…" : "No messages yet", this.loading ? null : "Say hello below.")
          : v_flex().id("transcript").flex_1().min_h(0).overflow_y_scroll().track_scroll(this.scroll).p(10).gap(8).children(views.map((view) => this.message(t, view, chat))),
      )
      .when(Boolean(this.sendError), (el) => el.child(div().px(12).py(4).text_size(11.5).text_color(t.blocked).child(this.sendError)))
      .child(
        h_flex()
          .flex_none()
          .p(10)
          .gap(8)
          .items_end()
          .border_t(1)
          .border_color(t.border)
          .child(div().flex_1().min_w(0).child(Textarea.new(this.input)))
          .child(this.button(t, "send", this.sending ? "Sending…" : "Send", true, (_event, cx) => this.send(cx), empty || this.sending)),
      );
  }

  listView(t) {
    const chats = visibleChats(this.chats.slice());
    if (chats.length === 0) return this.notice(t, "No bots yet", "Start an agent, or adopt one that is already running.", "New bot", (_event, cx) => this.openNewBot(cx));
    return v_flex().id("chat-list").flex_1().min_h(0).overflow_y_scroll().p(6).gap(2).children(chats.map((chat) => this.row(t, chat)));
  }

  render() {
    const t = theme();
    const counts = summarize(this.chats);
    let body;
    if (this.phase === "ready") body = this.selected != null ? this.chatView(t) : this.screen === "new-bot" ? this.newBot.render(t) : this.listView(t);
    else if (this.phase === "missing" || this.phase === "outdated") body = this.missingView(t);
    else if (this.phase === "installing") body = this.notice(t, this.installStep ?? PHASE_TEXT.installing, "This runs once. The file is checked before it is used.");
    else if (this.phase === "error") body = this.notice(t, "Cannot reach herdr-bot", this.error);
    else body = this.notice(t, PHASE_TEXT[this.phase] ?? "Connecting…");
    return v_flex()
      .id("herdr-bot")
      .size_full()
      .bg(t.chrome)
      .text_color(t.foreground)
      .when(this.phase !== "ready" || (this.selected == null && this.screen === "list"), (el) => el.child(
        h_flex()
          .h(40)
          .px(14)
          .flex_none()
          .items_center()
          .gap(8)
          .border_b(1)
          .border_color(t.border)
          .child(div().flex_1().text_size(13).font_semibold().child("herdr-bot"))
          .when(this.phase === "ready", (row) => row.child(div().id("new-bot").px(10).h(24).rounded(6).flex().items_center().cursor_pointer().text_size(12).font_semibold().text_color(t.foreground).bg(t.raised).hover((el) => el.bg(t.hover)).on_click((_event, cx) => this.openNewBot(cx)).child("+ New")))
          .when(counts.blocked > 0, (row) => row.child(div().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child(`${counts.blocked} need you`)))
          .when(counts.working > 0, (row) => row.child(div().text_size(11).text_color(t.muted).child(`${counts.working} working`))),
      ))
      .child(body);
  }
}
