// The "New bot" screen: start a fresh agent as a bot, or adopt one that is already running.
// Logic and rules live in form.js (pure, tested); this file is the drawing and the host calls.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { pickFolder } from "herdr";
import { PROVIDERS, REASONING_EFFORTS, adoptParams, canCreate, createParams, describeError, initialForm, providerById, withProvider } from "./form.js";

const CREATE_TIMEOUT_MS = 120000;

export class NewBot {
  /** @param {{ client: () => any, button: Function, onDone: (chatId: string, cx: any) => void, onCancel: (cx: any) => void }} deps */
  constructor({ client, button, onDone, onCancel }) {
    this.client = client;
    this.button = button;
    this.onDone = onDone;
    this.onCancel = onCancel;
    // Input state needs a live host call: build it once, here, from the view's init().
    this.nameInput = InputState.new({ placeholder: "Name, e.g. Scout" });
    this.cwdInput = InputState.new({ placeholder: "/path/to/project" });
    this.modelInput = InputState.new({ placeholder: "Model id" });
    // The bot's role: a short label, and optionally what it should do. Both are told to the bot.
    this.roleInput = InputState.new({ placeholder: "Role, e.g. Code reviewer (optional)" });
    this.personaInput = InputState.new({ placeholder: "What it should do, in a sentence (optional)" });
    for (const input of [this.nameInput, this.cwdInput, this.modelInput, this.roleInput, this.personaInput]) {
      input.on("change", (_event, cx) => {
        this.error = null;
        cx.notify();
      });
    }
    this.defaults = null;
    this.reset();
  }

  reset() {
    this.mode = "new";
    this.form = initialForm(this.defaults ?? {});
    this.models = { provider: null, state: "idle", list: [], error: null };
    this.adoptable = { state: "idle", list: [], error: null };
    this.adoptSelected = null;
    this.busy = false;
    this.error = null;
    this.needsHomeConfirm = false;
  }

  /** The form as it stands now: what is typed into the inputs wins over what was last stored. */
  current() {
    const typedModel = this.modelInput.value().trim();
    return {
      ...this.form,
      name: this.nameInput.value(),
      role: this.roleInput.value(),
      persona: this.personaInput.value(),
      cwd: this.cwdInput.value(),
      model: this.models.list.length === 0 && typedModel.length > 0 ? typedModel : this.form.model,
    };
  }

  open(cx) {
    this.reset();
    this.nameInput.set_value("");
    this.roleInput.set_value("");
    this.personaInput.set_value("");
    this.modelInput.set_value("");
    this.cwdInput.set_value("");
    cx.spawn(async (cx) => {
      try {
        if (this.defaults == null) this.defaults = await this.client().request("bot.defaults");
        this.form = initialForm(this.defaults);
        this.cwdInput.set_value(this.form.cwd);
      } catch (error) {
        this.error = describeError(error);
      }
      cx.notify();
      await this.loadModels(this.form.provider, cx);
    });
    cx.notify();
  }

  async loadModels(provider, cx) {
    this.models = { provider, state: "loading", list: [], error: null };
    cx.notify();
    try {
      const result = await this.client().request("bot.listModels", { provider });
      if (this.models.provider !== provider) return; // the person picked another provider meanwhile
      const list = result.models ?? [];
      this.models = { provider, state: "ready", list, error: result.error ?? null };
      if (this.form.model == null && list.length > 0) this.form = { ...this.form, model: list[0].id };
    } catch (error) {
      if (this.models.provider === provider) this.models = { provider, state: "error", list: [], error: describeError(error) };
    }
    cx.notify();
  }

  async loadAdoptable(cx) {
    this.adoptable = { state: "loading", list: [], error: null };
    cx.notify();
    try {
      this.adoptable = { state: "ready", list: await this.client().request("bot.listAdoptable"), error: null };
    } catch (error) {
      this.adoptable = { state: "error", list: [], error: describeError(error) };
    }
    cx.notify();
  }

  setMode(mode, cx) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.error = null;
    if (mode === "adopt" && this.adoptable.state === "idle") cx.spawn(async (cx) => this.loadAdoptable(cx));
    cx.notify();
  }

  pickProvider(id, cx) {
    const next = withProvider(this.form, id);
    if (next === this.form) return;
    this.form = next;
    this.modelInput.set_value("");
    this.error = null;
    cx.spawn(async (cx) => this.loadModels(id, cx));
    cx.notify();
  }

  pickAdoptable(agent, cx) {
    this.adoptSelected = agent.paneId;
    if (this.nameInput.value().trim().length === 0 && agent.name) this.nameInput.set_value(agent.name);
    cx.notify();
  }

  chooseFolder(cx) {
    cx.spawn(async (cx) => {
      try {
        const folder = await pickFolder({ prompt: "Use this folder" });
        if (folder != null) {
          this.cwdInput.set_value(folder);
          this.needsHomeConfirm = false;
          this.form = { ...this.form, allowHomeCwd: false };
        }
      } catch (error) {
        this.error = describeError(error);
      }
      cx.notify();
    });
  }

  submit(cx) {
    if (this.busy) return;
    const adopting = this.mode === "adopt";
    const form = this.current();
    let params;
    if (adopting) {
      const agent = this.adoptable.list.find((candidate) => candidate.paneId === this.adoptSelected);
      if (agent == null || form.name.trim().length === 0) return;
      params = adoptParams(agent, form.name, { role: form.role, persona: form.persona });
    } else {
      if (!canCreate(form)) return;
      params = createParams(form);
    }
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const { chat } = await this.client().request("bot.create", params, CREATE_TIMEOUT_MS);
        this.busy = false;
        this.onDone(chat.id, cx);
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

  heading(t, text) {
    return div().text_size(11).font_semibold().text_color(t.dim).child(text.toUpperCase());
  }

  choices(t, prefix, options, selected, onPick) {
    return h_flex().flex_wrap().gap(6).children(options.map((option) => div()
      .id(`${prefix}-${option.id}`)
      .px(10)
      .h(26)
      .rounded(7)
      .flex()
      .items_center()
      .text_size(12)
      .font_semibold()
      .cursor_pointer()
      .when(option.id === selected, (el) => el.bg(t.solid).text_color(t.solid_foreground))
      .when(option.id !== selected, (el) => el.bg(t.raised).text_color(t.foreground).hover((hover) => hover.bg(t.hover)))
      .on_click((_event, cx) => onPick(option.id, cx))
      .child(option.label)));
  }

  field(t, state) {
    return div().w_full().px(10).h(34).rounded(7).border_1().border_color(t.border).bg(t.background).text_color(t.foreground).text_size(13).child(Input.new(state));
  }

  modelPicker(t) {
    const provider = providerById(this.form.provider);
    if (!provider?.supportsModel) return null;
    const { state, list, error } = this.models;
    const picker = (() => {
      if (state === "loading" || state === "idle") return div().text_size(12).text_color(t.muted).child("Loading models…");
      if (list.length === 0) {
        return v_flex().gap(4)
          .child(div().text_size(12).text_color(t.muted).child(error ?? "No model list is available for this provider. Type a model id:"))
          .child(this.field(t, this.modelInput));
      }
      return v_flex().id("models").max_h(150).overflow_y_scroll().gap(2).children(list.map((model) => div()
        .id(`model-${model.id}`)
        .px(10)
        .h(28)
        .rounded(6)
        .flex()
        .items_center()
        .text_size(12.5)
        .cursor_pointer()
        .when(model.id === this.form.model, (el) => el.bg(t.selected).text_color(t.foreground))
        .when(model.id !== this.form.model, (el) => el.text_color(t.muted).hover((hover) => hover.bg(t.hover)))
        .on_click((_event, cx) => {
          this.form = { ...this.form, model: model.id };
          cx.notify();
        })
        .child(model.label)));
    })();
    return v_flex().gap(6).child(this.heading(t, "Model")).child(picker);
  }

  /** The role: a short label and, optionally, what the bot should do. */
  roleFields(t) {
    return v_flex().gap(6)
      .child(this.heading(t, "Role"))
      .child(this.field(t, this.roleInput))
      .child(this.field(t, this.personaInput))
      .child(div().text_size(11).text_color(t.dim).child("Shown under its name, and told to the bot every turn."));
  }

  newForm(t) {
    const provider = providerById(this.form.provider);
    return v_flex().gap(14)
      .child(v_flex().gap(6).child(this.heading(t, "Name")).child(this.field(t, this.nameInput)))
      .child(this.roleFields(t))
      .child(v_flex().gap(6).child(this.heading(t, "Provider")).child(this.choices(t, "provider", PROVIDERS, this.form.provider, (id, cx) => this.pickProvider(id, cx))))
      .child(this.modelPicker(t))
      .when(Boolean(provider?.supportsReasoning), (el) => el.child(v_flex().gap(6).child(this.heading(t, "Reasoning")).child(this.choices(t, "effort", REASONING_EFFORTS.map((id) => ({ id, label: id })), this.form.reasoningEffort, (id, cx) => {
        this.form = { ...this.form, reasoningEffort: id };
        cx.notify();
      }))))
      .child(v_flex().gap(6).child(this.heading(t, "Folder"))
        .child(h_flex().gap(8).items_center().child(div().flex_1().min_w(0).child(this.field(t, this.cwdInput))).child(this.button(t, "choose-folder", "Choose…", false, (_event, cx) => this.chooseFolder(cx)))))
      .child(v_flex().gap(6).child(this.heading(t, "Permissions"))
        .child(this.choices(t, "permission", [{ id: "ask", label: "Ask first" }, { id: "auto", label: "Auto" }], this.form.permissionMode, (id, cx) => {
          this.form = { ...this.form, permissionMode: id };
          cx.notify();
        })));
  }

  adoptForm(t) {
    const { state, list, error } = this.adoptable;
    const body = (() => {
      if (state === "loading" || state === "idle") return div().text_size(12).text_color(t.muted).child("Looking for running agents…");
      if (state === "error") return div().text_size(12).text_color(t.blocked).child(error);
      if (list.length === 0) return div().text_size(12).text_color(t.muted).child("No running agent that reports a status. Start one in a terminal first.");
      return v_flex().id("adoptable").max_h(220).overflow_y_scroll().gap(2).children(list.map((agent) => h_flex()
        .id(`adopt-${agent.paneId}`)
        .px(10)
        .py(6)
        .gap(8)
        .rounded(7)
        .items_center()
        .cursor_pointer()
        .when(agent.paneId === this.adoptSelected, (el) => el.bg(t.selected))
        .when(agent.paneId !== this.adoptSelected, (el) => el.hover((hover) => hover.bg(t.hover)))
        .on_click((_event, cx) => this.pickAdoptable(agent, cx))
        .child(v_flex().flex_1().min_w(0).child(div().truncate().text_size(12.5).font_semibold().child(agent.name ?? agent.paneId)).child(div().truncate().text_size(11).text_color(t.muted).child(`${agent.provider ?? "agent"} · ${agent.cwd ?? agent.paneId}`)))
        .child(div().text_size(11).text_color(t.muted).child(agent.status))));
    })();
    return v_flex().gap(14)
      .child(v_flex().gap(6).child(this.heading(t, "Running agents")).child(body))
      .child(v_flex().gap(6).child(this.heading(t, "Name")).child(this.field(t, this.nameInput)))
      .child(this.roleFields(t));
  }

  render(t) {
    const form = this.current();
    const adopting = this.mode === "adopt";
    const ready = adopting ? this.adoptSelected != null && form.name.trim().length > 0 : canCreate(form);
    return v_flex().flex_1().min_h(0)
      .child(h_flex().h(44).px(10).flex_none().items_center().gap(8).border_b(1).border_color(t.border)
        .child(div().id("newbot-back").px(8).h(26).rounded(6).flex().items_center().cursor_pointer().text_size(14).text_color(t.muted).hover((el) => el.bg(t.hover)).on_click((_event, cx) => this.onCancel(cx)).child("‹"))
        .child(div().flex_1().text_size(13).font_semibold().child("New bot")))
      .child(v_flex().id("newbot-body").flex_1().min_h(0).overflow_y_scroll().p(14).gap(14)
        .child(this.choices(t, "mode", [{ id: "new", label: "Start an agent" }, { id: "adopt", label: "Adopt a running one" }], this.mode, (id, cx) => this.setMode(id, cx)))
        .child(adopting ? this.adoptForm(t) : this.newForm(t)))
      .when(Boolean(this.error), (el) => el.child(div().px(14).py(6).text_size(11.5).text_color(t.blocked).child(this.error)))
      .when(this.needsHomeConfirm, (el) => el.child(h_flex().px(14).pb(6).child(this.button(t, "allow-home", "Use my home folder anyway", false, (_event, cx) => {
        this.form = { ...this.form, allowHomeCwd: true };
        this.needsHomeConfirm = false;
        this.submit(cx);
      }))))
      .child(h_flex().flex_none().p(12).gap(8).justify_end().border_t(1).border_color(t.border)
        .child(this.button(t, "newbot-cancel", "Cancel", false, (_event, cx) => this.onCancel(cx)))
        .child(this.button(t, "newbot-create", this.busy ? (adopting ? "Adopting…" : "Creating…") : (adopting ? "Adopt" : "Create"), true, (_event, cx) => this.submit(cx), !ready || this.busy)));
  }
}
