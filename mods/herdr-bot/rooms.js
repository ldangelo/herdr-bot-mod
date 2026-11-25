// Chat rooms: who can join, what a room's members are doing, the new-room form's rules. Pure.
// MAX_ROOM_MEMBERS mirrors core/src/rooms/constants.ts (mod/test/rooms.test.js checks it).

import { statusOf } from "./state.js";

export const MIN_ROOM_MEMBERS = 2;
export const MAX_ROOM_MEMBERS = 6;

/** Bots that can join a room: ones the person has not hidden and whose setup has finished (the host refuses the rest). */
export function eligibleBots(chats) {
  return chats.filter((chat) => chat.kind === "bot" && !chat.isHiddenFromSidebar && (chat.bot?.onboarding == null || chat.bot.onboarding.stage === "ready"));
}

/** A room's members in member order, each with the status of its own bot. A member that no longer exists shows as offline. */
export function memberStatuses(room, byId) {
  return (room.memberIds ?? []).map((id) => {
    const chat = byId.get(id);
    return { id, name: chat?.name ?? id, role: (chat?.title ?? "").trim(), status: chat == null ? "offline" : statusOf(chat) };
  });
}

/** Adds the bot if it is not selected and there is room, removes it if it is. The input is untouched. */
export function toggleMember(selected, id) {
  if (selected.includes(id)) return selected.filter((existing) => existing !== id);
  return selected.length >= MAX_ROOM_MEMBERS ? selected : [...selected, id];
}

export function canSubmitRoom({ name, selected, directory }) {
  return name.trim().length > 0 && selected.length >= MIN_ROOM_MEMBERS && selected.length <= MAX_ROOM_MEMBERS && directory.trim().length > 0;
}

export function roomCreateParams({ name, selected, directory, allowHomeCwd = false }) {
  return { name: name.trim(), memberIds: [...selected], directory: directory.trim(), ...(allowHomeCwd ? { allowHomeCwd: true } : {}) };
}

/** The folder to suggest for a new room: the one every selected bot already works in, or nothing when they differ. */
export function commonDirectory(chats, selected) {
  const folders = selected.map((id) => chats.find((chat) => chat.id === id)?.bot?.cwd ?? null);
  if (folders.length === 0 || folders.some((folder) => folder == null || folder.length === 0)) return "";
  return folders.every((folder) => folder === folders[0]) ? folders[0] : "";
}

function sameSet(a, b) {
  return a.length === b.length && a.every((item) => b.includes(item));
}

/** Whether saving would change anything: members compared as a set, the folder and name as typed. */
export function roomChanged(room, { name, selected, directory }) {
  return name.trim() !== room.name || directory.trim() !== (room.directory ?? "") || !sameSet(selected, room.memberIds ?? []);
}

/** "@atlas @scout": how to address one bot in a room (the host reads `@id`). */
export function mentionHint(memberIds) {
  return memberIds.map((id) => `@${id}`).join(" ");
}

export function describeRoomError(error) {
  switch (error?.code) {
    case "too_many_members": return `A room holds at most ${MAX_ROOM_MEMBERS} bots.`;
    case "bot_not_ready": return "One of those bots is still being set up. Try again in a moment.";
    case "unknown_bot": return "One of those bots no longer exists.";
    case "unknown_room": return "That room no longer exists.";
    case "invalid_directory": return `The folder is not usable: ${error.message}`;
    case "home_cwd_requires_confirmation": return "That is your home folder. Confirm below to use it, or choose a project folder.";
    default: return error?.message ?? "Something went wrong.";
  }
}
