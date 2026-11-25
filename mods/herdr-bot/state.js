// What the sidebar shows, derived from app-API chat summaries. Pure.

const RANK = { blocked: 4, working: 3, done: 2, idle: 1, offline: 0, unknown: 0 };

/**
 * One word for a chat's state, in herdr's own vocabulary where it has one. A room has no state of its own: it is what its
 * members are doing (needs you if any bot waits on an approval, working if any works), so pass `byId`, the chats by id.
 */
export function statusOf(chat, byId = null) {
  if (chat.kind === "room") {
    const members = (chat.memberIds ?? []).map((id) => byId?.get(id)).filter((member) => member != null).map((member) => statusOf(member));
    if (members.includes("blocked")) return "blocked";
    return chat.isRunning || members.includes("working") ? "working" : "idle";
  }
  if (chat.awaitingUserResponse?.reason === "approval") return "blocked";
  const status = chat.bot?.status ?? "unknown";
  return status in RANK ? status : "unknown";
}

export function rankOf(chat, byId = null) {
  return RANK[statusOf(chat, byId)] ?? 0;
}

/** The bot's role: the short label under its name ("" when it has none). */
export function roleOf(chat) {
  return (chat.title ?? "").trim();
}

/** Needs-you first, then working, then most recent; hidden chats are left out. */
export function visibleChats(chats) {
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  return chats
    .filter((chat) => !chat.isHiddenFromSidebar)
    .sort((a, b) => rankOf(b, byId) - rankOf(a, byId) || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) || a.name.localeCompare(b.name));
}

/** Folds one app-API event into the chat list; unknown events leave it untouched. */
export function applyEvent(chats, event) {
  if (event?.type === "chat.listChanged" && Array.isArray(event.payload)) return event.payload;
  if (event?.type === "chat.changed" && event.payload?.id != null) {
    const index = chats.findIndex((chat) => chat.id === event.payload.id);
    if (index < 0) return [...chats, event.payload];
    const next = chats.slice();
    next[index] = event.payload;
    return next;
  }
  return chats;
}

/** How many bots need the person or are working. Rooms are not counted: their members already are. */
export function summarize(chats) {
  const counts = { blocked: 0, working: 0 };
  for (const chat of chats) {
    if (chat.isHiddenFromSidebar || chat.kind === "room") continue;
    const status = statusOf(chat);
    if (status === "blocked") counts.blocked += 1;
    else if (status === "working") counts.working += 1;
  }
  return counts;
}
