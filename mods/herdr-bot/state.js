// What the sidebar shows, derived from app-API chat summaries. Pure.

const RANK = { blocked: 4, working: 3, done: 2, idle: 1, offline: 0, unknown: 0 };

/** One word for a chat's state, in herdr's own vocabulary where it has one. */
export function statusOf(chat) {
  if (chat.kind === "room") return chat.isRunning ? "working" : "idle";
  if (chat.awaitingUserResponse?.reason === "approval") return "blocked";
  const status = chat.bot?.status ?? "unknown";
  return status in RANK ? status : "unknown";
}

export function rankOf(chat) {
  return RANK[statusOf(chat)] ?? 0;
}

/** Needs-you first, then working, then most recent; hidden chats are left out. */
export function visibleChats(chats) {
  return chats
    .filter((chat) => !chat.isHiddenFromSidebar)
    .sort((a, b) => rankOf(b) - rankOf(a) || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) || a.name.localeCompare(b.name));
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

export function summarize(chats) {
  const counts = { blocked: 0, working: 0 };
  for (const chat of chats) {
    if (chat.isHiddenFromSidebar) continue;
    const status = statusOf(chat);
    if (status === "blocked") counts.blocked += 1;
    else if (status === "working") counts.working += 1;
  }
  return counts;
}
