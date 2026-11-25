// Turning app-API transcript entries into what the chat view draws, and keeping a list of them current. Pure.

function nameOf(author) {
  if (typeof author === "string") return author;
  return typeof author?.name === "string" ? author.name : null;
}

/**
 * One row to draw. The host's entries are open-ended (see docs/app-api.md): a user "message", a bot
 * "send-message", a "notice", an inline "prompt" card; anything else with text is shown as a plain line.
 */
export function entryView(entry) {
  const base = { id: entry.id, seq: entry.seq, timestampMs: entry.timestampMs };
  const text = typeof entry.content === "string" ? entry.content : typeof entry.message?.content === "string" ? entry.message.content : "";
  switch (entry.kind) {
    case "message": return { ...base, role: "user", author: nameOf(entry.author), text };
    case "send-message": return { ...base, role: "bot", author: nameOf(entry.author), text };
    case "notice": return { ...base, role: "notice", author: null, text };
    case "prompt": return { ...base, role: "prompt", author: null, text: entry.prompt?.question ?? "", prompt: entry.prompt ?? null, status: entry.status ?? "pending" };
    default: return { ...base, role: "other", author: nameOf(entry.author), text };
  }
}

/** Entries worth a row: an entry with nothing to show (a reaction-only update, say) is skipped. */
export function visibleEntries(entries) {
  return entries.map(entryView).filter((view) => view.role === "prompt" || view.text.trim().length > 0);
}

function bySeq(a, b) {
  return a.seq - b.seq;
}

/** Adds an entry or replaces the one with the same id; the result is in seq order and the input is untouched. */
export function upsertEntry(entries, entry) {
  const index = entries.findIndex((existing) => existing.id === entry.id);
  if (index >= 0) {
    const next = entries.slice();
    next[index] = entry;
    return next;
  }
  return [...entries, entry].sort(bySeq);
}

/** Joins an older (or refreshed) page with what is already held; the newer copy of a shared id wins. */
export function mergeEntries(existing, incoming) {
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  for (const entry of incoming) byId.set(entry.id, entry);
  return [...byId.values()].sort(bySeq);
}

/** Folds a transcript event for `chatId` into its entries; any other event leaves them as they are. */
export function applyTranscriptEvent(entries, chatId, event) {
  if (event?.type !== "transcript.entryAppended" && event?.type !== "transcript.entryUpdated") return entries;
  if (event.payload?.chatId !== chatId || event.payload?.entry?.id == null) return entries;
  return upsertEntry(entries, event.payload.entry);
}

export function lastSeq(entries) {
  return entries.reduce((max, entry) => Math.max(max, entry.seq), 0);
}

/**
 * Events carry one counter across every type and there is no replay: a jump means something was missed
 * (a reconnect, a dropped message) and the lists must be fetched again.
 */
export function isSeqGap(previous, seq) {
  return previous != null && seq !== previous + 1;
}

/** A prompt card a person can still answer with one click: pending, single choice, no typing needed. */
export function isOneClickPrompt(view) {
  return view.role === "prompt" && view.status === "pending" && view.prompt != null && !view.prompt.multiSelect && Array.isArray(view.prompt.options) && view.prompt.options.length > 0;
}
