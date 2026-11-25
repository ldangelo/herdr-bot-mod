// The new-bot form: providers and their launch rules, what is still missing, and what to send. Pure.
// The provider list mirrors renderer/src/features/dialogs/provider-catalog.ts, and `missingChoices` mirrors the
// host's missingLaunchChoices (core/src/bots/launch-args.ts); mod/test/form.test.js checks both stay in step.

export const PROVIDERS = [
  { id: "claude", label: "Claude Code", supportsModel: true, supportsReasoning: true },
  { id: "codex", label: "Codex", supportsModel: true, supportsReasoning: true },
  { id: "grok", label: "Grok CLI", supportsModel: true, supportsReasoning: true },
  { id: "agy", label: "Antigravity CLI", supportsModel: true, supportsReasoning: false },
  { id: "opencode", label: "OpenCode", supportsModel: true, supportsReasoning: false },
];

export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const DEFAULT_REASONING = "high";

export function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/** `defaults` is the host's bot.defaults result: { cwd, provider, permissionMode, homeDir }. */
export function initialForm(defaults = {}) {
  const provider = providerById(defaults.provider)?.id ?? PROVIDERS[0].id;
  return {
    provider,
    model: null,
    reasoningEffort: providerById(provider).supportsReasoning ? DEFAULT_REASONING : null,
    name: "",
    cwd: typeof defaults.cwd === "string" ? defaults.cwd : "",
    permissionMode: defaults.permissionMode === "auto" ? "auto" : "ask",
    allowHomeCwd: false,
  };
}

/** Picking another provider drops a model that belongs to the old one, and a reasoning level it cannot take. */
export function withProvider(form, id) {
  const provider = providerById(id);
  if (provider == null || provider.id === form.provider) return form;
  return { ...form, provider: provider.id, model: null, reasoningEffort: provider.supportsReasoning ? form.reasoningEffort ?? DEFAULT_REASONING : null };
}

/** What the host would still ask for: a model wherever the provider takes one, a reasoning level likewise. */
export function missingChoices(form) {
  if (!(form.provider ?? "").trim()) return ["provider"];
  // Like the host, an unknown provider is not "missing" anything here: it is refused later as unsupported.
  const provider = providerById(form.provider);
  return [
    ...(provider?.supportsModel && !(form.model ?? "").trim() ? ["model"] : []),
    ...(provider?.supportsReasoning && form.reasoningEffort == null ? ["reasoningEffort"] : []),
  ];
}

export function canCreate(form) {
  return providerById(form.provider) != null && missingChoices(form).length === 0 && form.name.trim().length > 0 && form.cwd.trim().length > 0;
}

/** The bot.create params: only what this provider accepts (the host rejects a model or effort it cannot take). */
export function createParams(form) {
  const provider = providerById(form.provider);
  return {
    name: form.name.trim(),
    provider: form.provider,
    cwd: form.cwd.trim(),
    permissionMode: form.permissionMode,
    ...(provider?.supportsModel && form.model != null ? { model: form.model } : {}),
    ...(provider?.supportsReasoning && form.reasoningEffort != null ? { reasoningEffort: form.reasoningEffort } : {}),
    ...(form.allowHomeCwd ? { allowHomeCwd: true } : {}),
  };
}

/** bot.create params for an agent that is already running (an `AdoptableAgent`'s paneId). */
export function adoptParams(agent, name) {
  return { name: name.trim(), adoptPaneId: agent.paneId };
}

/** A person-readable line for an API error code. */
export function describeError(error) {
  switch (error?.code) {
    case "invalid_launch_options": return "Pick a model and a reasoning level for this provider.";
    case "bot_exists": return "A bot with that name already exists. Pick another name.";
    case "home_cwd_requires_confirmation": return "That is your home folder. Confirm below to use it, or choose a project folder.";
    case "missing_cwd": return "Choose a working folder.";
    case "unsupported_kind": return "That provider is not supported here.";
    case "invalid_bot_id": return "That name cannot be turned into a bot id. Use letters and numbers.";
    case "herdr_error": return `The agent could not be started: ${error.message}`;
    default: return error?.message ?? "Something went wrong.";
  }
}
