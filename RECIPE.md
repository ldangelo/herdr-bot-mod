# herdr-bot

A chat panel for your coding agents inside the Herdr window. Each agent (Claude Code, Codex, Grok, Antigravity, OpenCode, Oh My Pi, Pi, or any agent that reports its status) becomes a "bot" you can message. Bots can also message each other, and you can put several in a **room** to talk to them all in one conversation. You see who is working, who is waiting for you, and who is idle, and you can answer an agent's permission prompt with one click instead of switching to its terminal.

![herdr-bot](preview.png)

*The preview shows two copies of the panel in a layout of the person's own, played by a scripted demo agent: on the left one opened on a chat with an approval card waiting, on the right the bot list.*

**This mod runs programs, reaches the network and downloads an executable.** Read *Watch out* before adding it.

## What you see

A panel that docks on the right, 360 px wide (`mod.json`: `place: "right"`, `size: 360`, `focusable: true`). Its background is the theme's `chrome` color, its text `foreground`. It has these screens: the bot list, a chat, New bot, New room, Room settings and a bot's Role, plus a set of centered status messages.

**The bot list.** A 40 px header with a 1 px `border` line under it and 14 px side padding. The title `herdr-bot` is 13 px semibold. On the right, in order: a `+ New` button (24 px tall, 10 px side padding, 6 px radius, `raised` background, 12 px semibold), a `+ Room` button of the same look (shown only when there are at least two ready bots), then, when they apply, a pill `N need you` (18 px tall, 5 px radius, 10.5 px semibold `blocked` text on `blocked` at 15% opacity) and the text `N working` (11 px, `muted`). Under it a scrolling list, 6 px padding and 2 px between rows. Each row is 10 px wide padding by 8 px tall, an 8 px radius, `hover` background on hover, and shows:

- a round avatar, 30 px, `raised` background, the name's first letter uppercased (13 px semibold); a room shows `#`;
- the name (13 px semibold, `foreground`) over a one-line preview (11.5 px, `muted`, truncated): the last message, else the bot's role or provider name, or for a room its number of bots and the last part of its folder;
- an unread badge when there are unread messages: 18 px pill, `accent` background, `accent_foreground` number (10.5 px semibold);
- a status mark, far right (see *How it behaves*).

Rows are ordered: needs you, working, done, idle, then offline or unknown; within each, most recent first. Chats the host marks hidden are left out. A room's mark follows its members: `Needs you` if any bot in it is waiting for you, working if any is working, else idle. With no bots it says `No bots yet`, `Start an agent, or adopt one that is already running.` and a `New bot` button.

**A chat.** Replaces the list. A 44 px header: a `‹` back button, a 24 px avatar, the bot's name (13 px semibold, truncated) and the same status mark. Below it the transcript scrolls, with 10 px padding and 8 px between messages. Your messages sit on the right (`selected` background), the bot's on the left (`raised` background) with the author's name above them (11 px semibold, `muted`). A bubble is at most 280 px wide, 10 px by 7 px padding, 10 px radius, 13 px text, split into one line per newline. System notices are a single 11.5 px `dim` line. At the bottom, over a 1 px `border` line, a composer with 10 px padding: a multi-line text area (placeholder `Message`, grows from 2 to 8 rows) and a `Send` button (primary: `solid` background and `solid_foreground` text; when the box is empty or sending, `raised` background and `dim` text). An error from sending shows above it in 11.5 px `blocked`.

**A room.** The same screen as a chat, with a strip under the header listing each member: a 7 px presence dot (working pulses, waiting is `blocked`, otherwise an outline), the name (11 px semibold) and its role (10.5 px, `muted`). The header's subtitle shows the room's folder and a `Settings` button opens Room settings. Bots answer in turn, each bubble labelled with its author. Above the composer a hint reads `Everyone answers in turn. Address one bot with @id @id.` (an `@id` first in your message makes that bot answer first).

**An approval card** appears in the transcript where an agent asked for permission: a 1 px border, 10 px radius, 10 px padding, `raised` background. While it is answerable the border is `blocked` at 40% and the first line reads `NEEDS YOU` (10.5 px semibold, `blocked`); afterwards the border is `border` and that line shows the status in capitals (`ANSWERED`, in `dim`). Then the prompt's title (12 px semibold), its question (13 px), its detail lines (13 px, `muted`), and one button per option labelled `1. Yes`, `2. Yes, and don't ask again…`, `3. No`.

**New bot.** A 44 px header with `‹` and `New bot`; a scrolling body with 14 px padding and 14 px between sections; a footer with `Cancel` and a primary `Create` / `Adopt` button. A toggle at the top chooses `Start an agent` or `Adopt a running one`. Starting shows, each under a small uppercase 11 px `dim` heading: **Name** (text field); **Provider** (pills: Claude Code, Codex, Grok CLI, Antigravity CLI, OpenCode, Oh My Pi, Pi); **Model** (for the providers that take one: a list at most 150 px tall, or a text field when the host has no list; Oh My Pi and Pi start the list with `Default (the model set up in the CLI)`, and a model is optional for them); **Reasoning** (pills `low medium high xhigh max`, only for Claude Code, Codex and Grok, `high` selected first); **Folder** (text field and a `Choose…` button for the system folder picker); **Permissions** (`Ask first` or `Auto`). Adopting lists running agents that report a status (name, provider and folder, status at the right) and a Name field.

**New room.** The same layout as New bot, titled `New room`: **Name** (text field), **Bots in the room** (a checkbox row per ready bot with avatar, name, role and status; a counter `2 of 6`, red until at least two are picked; at most six), **Folder** (text field and `Choose…`; every bot in the room is told to work there, a bot's own starting folder does not change). The footer has `Cancel` and a primary `Create`; picking your home folder asks for confirmation (`Use my home folder anyway`).

**Room settings.** The same form for an existing room, titled `Room settings`: change the name, the members and the folder, `Save`, or `Delete room` (it asks `Really delete?` first). Deleting a room keeps the bots.

**A bot's settings.** `Settings` in a chat's header opens a screen with **Name**, **Role** (a short label, e.g. `Code reviewer`) and **What it does** (a sentence). The host tells the bot all three every turn (`You are Atlas, Code reviewer…`), which matters most in a room. For a bot this mod started (not an adopted agent) it continues with the launch settings, under a rule: **Model** (the same list as New bot), **Reasoning** (providers that take it), **Folder** (text field and `Choose…`) and **Permissions** (`Ask first` or `Auto`). The provider cannot change. A change to any launch setting restarts the agent and keeps the conversation (`bot.updateLaunchSettings`); the hint above them says so. Only the fields you changed are sent. New bot and Adopt have the role fields too.

**Status messages**, centered with 24 px side padding: `Connecting to herdr-bot…`, `Starting the herdr-bot host…`, `Installing the herdr-bot host…`, `Lost the host. Reconnecting…`, and two that ask a question (see *How it behaves*).

## How it behaves

**Status marks** (list rows and chat headers): *blocked* is a `Needs you` pill (as above); *working* is an 8 px dot in `working` that fades between 35% and 100% opacity over 1.1 s; *idle* is an 8 px ring (1.5 px `idle` border); *done* is an 8 px `done` dot; anything else is an 8 px `dim` dot at 40%. A room's mark follows its members (see above).

**Clicks.** A row opens its chat. `‹` goes back. `+ New` (or the empty state's `New bot`) opens New bot; `+ Room` opens New room. `Send` sends the composer's text; so does the text area's submit. An option button on an approval card answers it (single-choice prompts only; a card that needs typing or several choices says `This one needs typing or several choices: answer it in <name>'s terminal.`). `Create` starts the agent and opens its chat; `Adopt` does the same for the selected running agent. If the folder is your home folder it asks for confirmation (`Use my home folder anyway`).

**Live.** Everything updates by push, never by polling: new messages, replies, status changes, new bots. Opening a chat marks it read once its newest message is on screen and scrolls to the end. If the event numbering skips (a reconnect, a dropped message) it reloads the list and the open chat.

**The host.** Nothing runs in the mod itself. A background program, the herdr-bot *host* (`herdr-bot serve`), does the work: starting agents, taking turns, storing transcripts. When the panel opens it reads `~/.herdr-bot/ws.json` (`{port, token, pid}`), connects to `ws://127.0.0.1:<port>`, and sends `{"op":"auth","token":…}`; if there is no host it starts one with `hc run --bg --name herdr-bot-host --no-parent --outlive-parent --no-notify -- env HERDR_BOT_HOME=<home> <home>/bin/herdr-bot serve --runtime hc --exit-when-idle 30`. The host stops itself 30 seconds after the last panel disconnects, so closing Herdr stops it; the agents it started keep running.

**First use.** If `<home>/bin/herdr-bot` does not exist the panel says `herdr-bot needs its host program` and, once it has read the release manifest, `Download 85 MB from github.com (version 1.5.1). It is checked against its checksum, then run on this computer.` with a `Download` button. Nothing is downloaded before that click. On this computer's platform it fetches `manifest.json` from `https://github.com/ldangelo/herdr-app-bot/releases/download/host-v1.5.1`, downloads that platform's file with `curl` (https only), verifies its SHA-256 against the manifest, makes it executable and moves it into place. A wrong checksum or failed download installs nothing and leaves no partial file.

**Updates.** When it connects, the host reports its version. A host with the same major version and at least `1.5.1` is used. An older one, or one that reports no version, makes the panel say `The herdr-bot host needs updating` with the same kind of download prompt (`Update`); it then stops the old host (`hc kill herdr-bot-host`, `hc rm herdr-bot-host`), installs the new file and starts it.

**Props** (set on a `tab.new {mod: "herdr-bot", props: {…}}`): `chat` opens that chat directly; `screen: "new-bot"` or `"new-room"` opens that screen once connected; `screen: "room-settings"` or `"profile"` together with `chat` opens Room settings or the Role screen; `installHost: true` pre-approves the download (for scripted setups; omit it for people).

**Config.** `<app home>/herdr-bot.json` may hold `{"home": "<folder>", "hostSource": "https://…"}`: where the host keeps its files (default `~/.herdr-bot`) and where it is downloaded from (default the release above; only `https`, or `http` to this computer, is accepted).

## Built from

`mods/herdr-bot/` has one view and thirteen small modules, all plain JavaScript:

| File | Does |
|---|---|
| `mod.json` | `place: "right"`, `size: 360`, `focusable: true`, one palette entry `herdr-bot: open chats` running `mod.open {name: "herdr-bot"}` |
| `main.js` | the view (default-exports a `View`): connection lifecycle, the three screens, status messages |
| `client.js` | WebSocket client: auth, request/response by id with timeouts, pushed events, the host's `ready` version |
| `host.js` | find the host, start it if absent, wait for it; the launch arguments; the "outdated host" error |
| `install.js` | plan and perform the host download: https-only, manifest, `curl`, `shasum -a 256`, atomic `mv` |
| `version.js` | the required host version, semver comparison, the pinned release URL |
| `state.js` | chat list ordering, status words, folding events into the list |
| `transcript.js` | turning host entries into rows, merging pages, folding transcript events, gap detection |
| `form.js` | the new-bot form's providers and rules, parameters to send (including role), error wording |
| `newbot.js` | the New bot screen |
| `rooms.js` | room rules: which bots can join, the six-bot limit, member statuses, `room.create` parameters, error wording |
| `newroom.js` | the New room and Room settings screen |
| `profile.js` | the bot Settings screen |
| `settings.js` | settings rules: what can be edited, which fields changed, what to send, why a form cannot be saved |
| `ui.js` | headings, text fields, avatars and checkboxes the screens share |

**Herdr APIs:** from `herdr`: `theme`, `props`, `checking`, `appHome`, `home`, `readTextFile`, `exec`, `hc`, `pickFolder`. From the runtime: `fetch` (the manifest), `WebSocket` from `websocket` (to the host), `arch` and `platform` from `os`. From `gpui-base`: `v_flex`, `h_flex`, `ScrollHandle` (`scroll_to_item` keeps the newest message in view), `TextareaState`/`Textarea` (composer), `InputState`/`Input` (fields). Animation is `.loop("opacity", {from: .35, to: 1, period: 1100})`; there are no timers.

**The host's API** (one JSON message each, over the WebSocket): `chat.list`, `chat.markRead`, `transcript.page`, `message.send`, `prompt.answer`, `bot.defaults`, `bot.listModels`, `bot.listAdoptable`, `bot.create`, `room.create`, `room.setMembers`, `room.setDirectory`, `chat.updateProfile`, `bot.updateLaunchSettings`, `chat.delete`; pushed events `chat.listChanged`, `chat.changed`, `transcript.entryAppended`, `transcript.entryUpdated`. The host itself is a separate program from <https://github.com/ldangelo/herdr-app-bot> (it starts agents with `hc`, so it needs herdr-core).

**Colors are all theme colors**, so the panel follows light and dark themes: `chrome`, `foreground`, `muted`, `dim`, `border`, `raised`, `selected`, `hover`, `background`, `solid`, `solid_foreground`, `accent`, `accent_foreground`, `blocked`, `working`, `idle`, `done`. The `blocked` tints are the theme color with an alpha suffix (`+"26"`, `+"66"`).

## Watch out

**What this mod does on your computer.** It runs programs (`exec`: `test`, `mkdir`, `curl`, `shasum`, `chmod`, `mv`, `rm`; `hc`: `run`, `kill`, `rm`). It reaches the network: one `fetch` and one `curl` download from github.com, and a WebSocket to `127.0.0.1`. It reads `<app home>/herdr-bot.json` and `~/.herdr-bot/ws.json` (that file holds a token for the local host, readable only by you). It writes `~/.herdr-bot/bin/herdr-bot`. It **downloads and runs an executable** (85–104 MB depending on the platform, from the herdr-bot releases on GitHub) that starts and talks to your coding agents. The checksum protects against a damaged download, not against a compromised release: you are trusting that GitHub repository.

- **The mod is not enough on its own.** It needs the host program, which it downloads on first use. On a machine with no `curl` or `shasum`, or on Windows, it cannot install it (the panel says why).
- **Platforms:** macOS (Apple silicon and Intel) and Linux (x64, arm64). Windows is not supported. Only the macOS Apple-silicon build has been run end to end; the others are built by CI but unproven.
- **Herdr-app reports CPUs the Rust way** (`aarch64`, `x86_64`), not as Node does (`arm64`, `x64`): normalize both before looking up a build.
- **`readTextFile` refuses binaries** (UTF-8 only, 1 MiB at most), so test for the host with `exec("test", ["-x", path])`, not by reading it.
- **Do not name the `init` parameter `props`:** it shadows the imported `props()`.
- **A mod that fails to load stays broken until Herdr restarts**, even after you fix it. `herdr-app check` does not run async code, so it will not catch most runtime mistakes.
- **Shipped layouts are not changed**, so there the mod appears only when you open it: `herdr-app do mod.open '{"name":"herdr-bot"}'` or as a tab: `herdr-app do tab.new '{"mod":"herdr-bot"}'`. In a layout of your own (for example after `layout.clone`), Herdr docks it on the right, 360 px wide, the first time it sees the folder.
- **Bots started here appear in this panel, not in Herdr's Agents list**, because they run without a pane. They are visible in `hc ls`.
- **What has been tried:** every screen (rooms, room folders and roles included, with scripted agents: the roles and the folder reached each bot's prompt), the live updates, an approval card answered, the host download, an update, and the host stopping with the app were run in a real Herdr window. Typing into fields, clicking buttons and the folder picker were exercised through the host's API rather than by hand.
- **Rooms** hold two to six ready bots; the host takes turns, at most three rounds or ten messages per message from you. In a room, answer an approval card with the card's own bot, not the room: the mod does this for you.
- **Not built yet:** search, markdown rendering, multi-choice and free-text approval cards. Some system notices from the host are in Korean.

## Done when

1. `herdr-app check mods/herdr-bot` passes.
2. With no `<home>/bin/herdr-bot`, `herdr-app do mod.open '{"name":"herdr-bot"}'` shows `herdr-bot needs its host program` with a size and `github.com`, and nothing is downloaded until `Download` is pressed.
3. After the download, `<home>/bin/herdr-bot` exists and runs (`herdr-bot dance` exits non-zero with `unknown command "dance"`), `hc ls` shows a terminal named `herdr-bot-host`, and `<home>/ws.json` is readable only by you.
4. Adopting a running agent that reports a status (OSC 7501) makes its row appear in the open panel without reloading; the row shows its status mark.
5. Sending it a message puts your bubble on the right, and the agent's reply appears on the left by itself.
6. An agent stopped at a permission prompt shows a `NEEDS YOU` card and a `Needs you` pill in the header and the list; pressing `1. Yes` delivers the key to the agent and the card reads `ANSWERED`.
7. Closing the Herdr window makes the `herdr-bot-host` terminal disappear within about 35 seconds, removes `ws.json`, and leaves the agents running in `hc ls`.
8. Replacing `<home>/bin/herdr-bot` with a host older than `1.5.1` and reopening the panel shows `The herdr-bot host needs updating`.
9. With two ready bots, `+ Room` opens New room; `Create` stays disabled until a name, a folder and at least two bots are given. After it, the room appears in the list with `#`, and a message in it is answered by each bot in turn.
10. Giving a room a folder (`Choose…` or typing a path) and saving makes the host add `Room working directory: <folder>` to each bot's prompt; `chat.list` shows it as the room's `directory`.
11. Setting a bot's role in `Settings` changes the subtitle under its name in the list and in a room's strip.
12. Changing a started bot's model in `Settings` and saving restarts its agent (`hc ls` shows it with the new `--model`) and its conversation is still there.
13. When one bot in a room is stopped at a permission prompt, the room row and the strip show `Needs you` for that bot, and pressing an option on its card delivers the key to that bot.
