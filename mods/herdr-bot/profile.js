// The role screen: a bot's role (the short label under its name) and what it should do. Both are told to the bot every turn.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState } from "gpui-base";
import { roleOf } from "./state.js";
import { avatar, field, heading } from "./ui.js";

export class ProfileEditor {
  /** @param {{ client: () => any, button: Function, onDone: (cx: any) => void, onCancel: (cx: any) => void }} deps */
  constructor({ client, button, onDone, onCancel }) {
    this.client = client;
    this.button = button;
    this.onDone = onDone;
    this.onCancel = onCancel;
    this.roleInput = InputState.new({ placeholder: "e.g. Code reviewer" });
    this.personaInput = InputState.new({ placeholder: "What it should do, in a sentence (optional)" });
    for (const input of [this.roleInput, this.personaInput]) {
      input.on("change", (_event, cx) => {
        this.error = null;
        cx.notify();
      });
    }
    this.chat = null;
    this.busy = false;
    this.error = null;
  }

  open(cx, chat) {
    this.chat = chat;
    this.busy = false;
    this.error = null;
    this.roleInput.set_value(roleOf(chat));
    this.personaInput.set_value((chat.description ?? "").trim());
    cx.notify();
  }

  get changed() {
    return this.chat != null && (this.roleInput.value().trim() !== roleOf(this.chat) || this.personaInput.value().trim() !== (this.chat.description ?? "").trim());
  }

  submit(cx) {
    if (this.busy || this.chat == null || !this.changed) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // An empty string clears a field on the host.
        await this.client().request("chat.updateProfile", { chatId: this.chat.id, title: this.roleInput.value().trim(), description: this.personaInput.value().trim() });
        this.busy = false;
        this.onDone(cx);
        return;
      } catch (error) {
        this.error = String((error && error.message) || error);
      }
      this.busy = false;
      cx.notify();
    });
  }

  render(t) {
    const chat = this.chat;
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
          .child(div().flex_1().truncate().text_size(13).font_semibold().child(chat == null ? "Role" : `${chat.name}'s role`)),
      )
      .child(
        v_flex()
          .id("profile-body")
          .flex_1()
          .min_h(0)
          .overflow_y_scroll()
          .p(14)
          .gap(14)
          .child(v_flex().gap(6).child(heading(t, "Role")).child(field(t, this.roleInput)))
          .child(v_flex().gap(6).child(heading(t, "What it does")).child(field(t, this.personaInput)))
          .child(div().text_size(11).text_color(t.dim).child("The bot is told this every turn (\"You are Atlas — Code reviewer…\"), so it shapes how it answers, most of all in a room with other bots.")),
      )
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
