// Small drawing helpers the screens share. They need herdr-app's UI runtime, so unlike the logic modules they only run in the app.

import { div } from "gpui-kit";
import { Input } from "gpui-base";

/** A small uppercase section heading. */
export function heading(t, text) {
  return div().text_size(11).font_semibold().text_color(t.dim).child(text.toUpperCase());
}

/** A bordered single-line text field around an InputState. */
export function field(t, state) {
  return div().w_full().px(10).h(34).rounded(7).border_1().border_color(t.border).bg(t.background).text_color(t.foreground).text_size(13).child(Input.new(state));
}

/** A round avatar showing the label's first character, uppercased. */
export function avatar(t, label, size) {
  return div().size(size).flex_none().rounded(size / 2).bg(t.raised).flex().items_center().justify_center().text_size(size * 0.43).font_semibold().text_color(t.foreground).child((label || "?").slice(0, 1).toUpperCase());
}

/** A 16 px checkbox: filled with a tick when on, an outline when off, dimmed when it cannot be changed. */
export function checkbox(t, on, disabled = false) {
  return div()
    .size(16)
    .flex_none()
    .rounded(4)
    .flex()
    .items_center()
    .justify_center()
    .text_size(11)
    .font_bold()
    .when(on, (el) => el.bg(t.solid).text_color(t.solid_foreground).child("✓"))
    .when(!on, (el) => el.border(1.5).border_color(disabled ? t.dim + "66" : t.muted));
}
