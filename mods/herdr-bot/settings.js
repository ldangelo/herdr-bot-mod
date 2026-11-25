// A bot's settings after it exists: what can be edited, what changed, and what the host calls would be. Pure.
// Name, role and persona are a profile edit (`chat.updateProfile`). Model, reasoning, folder and permissions are launch
// settings (`bot.updateLaunchSettings`): the host restarts the agent for them and keeps the conversation. The provider
// cannot change, and an adopted agent's launch settings belong to whoever started it.

import { providerById } from "./form.js";
import { roleOf } from "./state.js";

/** Launch settings can be edited for a bot herdr-bot started (not an adopted pane) on a provider the form knows. */
export function canEditLaunch(chat) {
  return chat?.kind === "bot" && chat.bot != null && chat.bot.adopted !== true && providerById(chat.bot.provider) != null;
}

/** The form's starting values for a bot. */
export function initialSettings(chat) {
  const bot = chat.bot ?? {};
  return {
    name: chat.name ?? "",
    role: roleOf(chat),
    persona: (chat.description ?? "").trim(),
    model: bot.model ?? null,
    reasoningEffort: bot.reasoningEffort ?? null,
    cwd: bot.cwd ?? "",
    permissionMode: bot.permissionMode === "auto" ? "auto" : "ask",
    allowHomeCwd: false,
  };
}

/**
 * What to send. `profile` and `launch` are each null when nothing in them changed, and carry only the changed keys.
 * An empty role or persona is sent as "" (the host clears the field).
 */
export function settingsChanges(chat, edit) {
  const before = initialSettings(chat);
  const profile = {};
  const name = edit.name.trim();
  if (name.length > 0 && name !== before.name) profile.name = name;
  if (edit.role.trim() !== before.role) profile.title = edit.role.trim();
  if (edit.persona.trim() !== before.persona) profile.description = edit.persona.trim();

  const launch = {};
  if (canEditLaunch(chat)) {
    const provider = providerById(chat.bot.provider);
    if (provider.supportsModel && (edit.model ?? null) !== before.model) launch.model = edit.model ?? null;
    if (provider.supportsReasoning && edit.reasoningEffort != null && edit.reasoningEffort !== before.reasoningEffort) launch.reasoningEffort = edit.reasoningEffort;
    if (edit.cwd.trim().length > 0 && edit.cwd.trim() !== before.cwd) launch.cwd = edit.cwd.trim();
    if (edit.permissionMode !== before.permissionMode) launch.permissionMode = edit.permissionMode;
    if (Object.keys(launch).length > 0 && edit.allowHomeCwd) launch.allowHomeCwd = true;
  }
  return { profile: Object.keys(profile).length > 0 ? profile : null, launch: Object.keys(launch).length > 0 ? launch : null };
}

/** Why the form cannot be saved yet, or null. */
export function settingsProblem(chat, edit) {
  if (edit.name.trim().length === 0) return "A bot needs a name.";
  if (canEditLaunch(chat)) {
    const provider = providerById(chat.bot.provider);
    if (provider.supportsModel && !provider.modelOptional && (edit.model ?? "").trim().length === 0) return "Pick a model.";
    if (edit.cwd.trim().length === 0) return "Choose a working folder.";
  }
  return null;
}

export function settingsChanged(chat, edit) {
  const { profile, launch } = settingsChanges(chat, edit);
  return profile != null || launch != null;
}
