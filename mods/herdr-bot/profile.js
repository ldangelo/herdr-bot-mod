// A bot's settings screen: its name, role and what it does, and (for a bot herdr-bot started) its model, reasoning level,
// folder and permissions. The rules live in settings.js (pure, tested); this file is the drawing and the host calls.
// Name, role and persona are told to the bot every turn. The launch settings restart the agent; the conversation stays.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState } from "gpui-base";
import { pickFolder } from "herdr";
import { REASONING_EFFORTS, describeError, providerById } from "./form.js";
import { canEditLaunch, initialSettings, settingsChanged, settingsChanges, settingsProblem } from "./settings.js";
import { avatar, field, heading, pills } from "./ui.js";

const RESTART_TIMEOUT_MS = 120000;

export class ProfileEditor {
  /** @param {{ client: () => any, button: Function, onDone: (cx: any) => void, onCancel: (cx: any) => void }} deps */
  constructor({ client, button, onDone, onCancel }) {
    this.client = client;
    this.button = button;
    this.onDone = onDone;
    this.onCancel = onCancel;
    this.nameInput = InputState.new({ placeholder: "Name" });
    this.roleInput = InputState.new({ placeholder: "e.g. Code reviewer" });
    this.personaInput = InputState.new({ placeholder: "What it should do, in a sentence (optional)" });
    this.cwdInput = InputState.new({ placeholder: "/path/to/project" });
    this.modelInput = InputState.new({ placeholder: "provider/model (optional)" });
    for (const input of [this.nameInput, this.roleInput, this.personaInput, this.cwdInput, this.modelInput]) {
      input.on("change", (_event, cx) => {
        this.error = null;
        cx.notify();
      });
    }
    this.chat = null;
    this.edit = null;
    this.models = { provider: null, state: "idle", list: [], error: null };
    this.busy = false;
    this.error = null;
    this.needsHomeConfirm = false;
  }

  open(cx, chat) {
    this.chat = chat;
    this.edit = initialSettings(chat);
    this.busy = false;
    this.error = null;
    this.needsHomeConfirm = false;
    this.nameInput.set_value(this.edit.name);
    this.roleInput.set_value(this.edit.role);
    this.personaInput.set_value(this.edit.persona);
    this.cwdInput.set_value(this.edit.cwd);
    this.modelInput.set_value("");
    this.models = { provider: null, state: "idle", list: [], error: null };
    if (canEditLaunch(chat)) {
      const provider = providerById(chat.bot.provider);
      if (provider?.supportsModel) cx.spawn(async (cx) => this.loadModels(provider.id, cx));
    }
    cx.notify();
  }

  async loadModels(provider, cx) {
    this.models = { provider, state: "loading", list: [], error: null };
    cx.notify();
    try {
      const result = await this.client().request("bot.listModels", { provider });
      if (this.models.provider !== provider) return;
      this.models = { provider, state: "ready", list: result.models ?? [], error: result.error ?? null };
    } catch (error) {
      if (this.models.provider === provider) this.models = { provider, state: "error", list: [], error: describeError(error) };
    }
    cx.notify();
  }

  /** The form as it stands now: what is typed wins over what was last stored. A typed model only counts when no list was found. */
  current() {
    const typedModel = this.modelInput.value().trim();
    return {
      ...this.edit,
      name: this.nameInput.value(),
      role: this.roleInput.value(),
      persona: this.personaInput.value(),
      cwd: this.cwdInput.value(),
      model: this.models.list.length === 0 && typedModel.length > 0 ? typedModel : this.edit.model,
    };
  }

  get changed() {
    return this.chat != null && this.edit != null && settingsChanged(this.chat, this.current());
  }

  chooseFolder(cx) {
    cx.spawn(async (cx) => {
      try {
        const folder = await pickFolder({ prompt: "Use this folder" });
        if (folder != null) {
          this.cwdInput.set_value(folder);
          this.needsHomeConfirm = false;
          this.edit = { ...this.edit, allowHomeCwd: false };
        }
      } catch (error) {
        this.error = describeError(error);
      }
      cx.notify();
    });
  }

  submit(cx) {
    if (this.busy || this.chat == null || this.edit == null) return;
    const edit = this.current();
    const problem = settingsProblem(this.chat, edit);
    if (problem != null) {
      this.error = problem;
      cx.notify();
      return;
    }
    const { profile, launch } = settingsChanges(this.chat, edit);
    if (profile == null && launch == null) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // An empty string clears a field on the host.
        if (profile != null) await this.client().request("chat.updateProfile", { chatId: this.chat.id, ...profile });
        if (launch != null) await this.client().request("bot.updateLaunchSettings", { botId: this.chat.id, ...launch }, RESTART_TIMEOUT_MS);
        this.busy = false;
        this.onDone(cx);
        return;
      } catch (error) {
        this.error = describeError(error);
        if (error?.code === "home_cwd_requires_confirmation") this.needsHomeConfirm = true;
      }
      this.busy = false;
      cx.notify();
    });
  }

  // ---- drawing ----------------------------------------------------------------------------------

  modelPicker(t, provider) {
    const { state, list, error } = this.models;
    const picker = (() => {
      if (state === "loading" || state === "idle") return div().text_size(12).text_color(t.muted).child("Loading models…");
      if (list.length === 0) {
        return v_flex().gap(4)
          .child(div().text_size(12).text_color(t.muted).child(error ?? (provider.modelOptional ? "No model list is available. Leave this empty to keep the current model, or type provider/model:" : "No model list is available for this provider. Type a model id:")))
          .child(field(t, this.modelInput));
      }
      const rows = provider.modelOptional ? [{ id: null, label: "Default (the model set up in the CLI)" }, ...list] : list;
      return v_flex().id("settings-models").max_h(150).overflow_y_scroll().gap(2).children(rows.map((model) => div()
        .id(`settings-model-${model.id ?? "default"}`)
        .px(10)
        .h(28)
        .rounded(6)
        .flex()
        .items_center()
        .text_size(12.5)
        .cursor_pointer()
        .when(model.id === this.edit.model, (el) => el.bg(t.selected).text_color(t.foreground))
        .when(model.id !== this.edit.model, (el) => el.text_color(t.muted).hover((hover) => hover.bg(t.hover)))
        .on_click((_event, cx) => {
          this.edit = { ...this.edit, model: model.id };
          cx.notify();
        })
        .child(model.label)));
    })();
    return v_flex().gap(6).child(heading(t, "Model")).child(picker);
  }

  launchSection(t) {
    const provider = providerById(this.chat.bot.provider);
    return v_flex()
      .gap(14)
      .child(div().h(1).bg(t.border))
      .child(div().text_size(11).text_color(t.dim).child(`${provider.label}. Changing the model, folder or permissions restarts the agent; the conversation stays.`))
      .when(Boolean(provider.supportsModel), (el) => el.child(this.modelPicker(t, provider)))
      .when(Boolean(provider.supportsReasoning), (el) => el.child(v_flex().gap(6).child(heading(t, "Reasoning")).child(pills(t, "settings-effort", REASONING_EFFORTS.map((id) => ({ id, label: id })), this.edit.reasoningEffort, (id, cx) => {
        this.edit = { ...this.edit, reasoningEffort: id };
        cx.notify();
      }))))
      .child(v_flex().gap(6).child(heading(t, "Folder"))
        .child(h_flex().gap(8).items_center().child(div().flex_1().min_w(0).child(field(t, this.cwdInput))).child(this.button(t, "settings-choose-folder", "Choose…", false, (_event, cx) => this.chooseFolder(cx)))))
      .child(v_flex().gap(6).child(heading(t, "Permissions"))
        .child(pills(t, "settings-permission", [{ id: "ask", label: "Ask first" }, { id: "auto", label: "Auto" }], this.edit.permissionMode, (id, cx) => {
          this.edit = { ...this.edit, permissionMode: id };
          cx.notify();
        })));
  }

  render(t) {
    const chat = this.chat;
    const editable = chat != null && canEditLaunch(chat);
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
          .child(div().id("profile-back").px(8).h(26).rounded(6).flex().items_center().cursor_pointer().text_size(14).text_color(t.muted).hover((el) => el.bg(t.hover)).on_click((_event, cx) => this.onCancel(cx)).child("‹"))
          .child(avatar(t, chat?.name, 24))
          .child(div().flex_1().truncate().text_size(13).font_semibold().child(chat == null ? "Settings" : `${chat.name}'s settings`)),
      )
      .child(
        v_flex()
          .id("profile-body")
          .flex_1()
          .min_h(0)
          .overflow_y_scroll()
          .p(14)
          .gap(14)
          .child(v_flex().gap(6).child(heading(t, "Name")).child(field(t, this.nameInput)))
          .child(v_flex().gap(6).child(heading(t, "Role")).child(field(t, this.roleInput)))
          .child(v_flex().gap(6).child(heading(t, "What it does")).child(field(t, this.personaInput)))
          .child(div().text_size(11).text_color(t.dim).child("The bot is told its name, role and this every turn (\"You are Atlas — Code reviewer…\"), so it shapes how it answers, most of all in a room with other bots."))
          .when(editable, (el) => el.child(this.launchSection(t)))
          .when(chat != null && !editable, (el) => el.child(div().text_size(11).text_color(t.dim).child("This agent was already running when it was adopted, so its model, folder and permissions are not managed here."))),
      )
      .when(this.needsHomeConfirm, (el) => el.child(h_flex().px(14).pb(6).child(this.button(t, "settings-allow-home", "Use my home folder anyway", false, (_event, cx) => {
        this.edit = { ...this.edit, allowHomeCwd: true };
        this.needsHomeConfirm = false;
        this.submit(cx);
      }))))
      .when(Boolean(this.error), (el) => el.child(div().px(14).py(6).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(
        h_flex()
          .flex_none()
          .p(12)
          .gap(8)
          .justify_end()
          .border_t(1)
          .border_color(t.border)
          .child(this.button(t, "profile-cancel", "Cancel", false, (_event, cx) => this.onCancel(cx)))
          .child(this.button(t, "profile-save", this.busy ? "Saving…" : "Save", true, (_event, cx) => this.submit(cx), !this.changed || this.busy)),
      );
  }
}
