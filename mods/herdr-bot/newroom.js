// The room screen: make a chat room, or change one (its name, members and folder, or delete it). Rules live in rooms.js.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState } from "gpui-base";
import { pickFolder } from "herdr";
import { MAX_ROOM_MEMBERS, MIN_ROOM_MEMBERS, canSubmitRoom, commonDirectory, describeRoomError, eligibleBots, roomChanged, roomCreateParams, toggleMember } from "./rooms.js";
import { statusOf, roleOf } from "./state.js";
import { avatar, checkbox, field, heading } from "./ui.js";

export class RoomEditor {
  /** @param {{ client: () => any, button: Function, onDone: (roomId: string, cx: any) => void, onCancel: (cx: any) => void, onDeleted: (cx: any) => void }} deps */
  constructor({ client, button, onDone, onCancel, onDeleted }) {
    this.client = client;
    this.button = button;
    this.onDone = onDone;
    this.onCancel = onCancel;
    this.onDeleted = onDeleted;
    // Input state needs a live host call: build it once, here, from the view's init().
    this.nameInput = InputState.new({ placeholder: "Room name, e.g. Review crew" });
    this.directoryInput = InputState.new({ placeholder: "/path/to/project" });
    this.nameInput.on("change", (_event, cx) => {
      this.error = null;
      cx.notify();
    });
    this.directoryInput.on("change", (_event, cx) => {
      this.error = null;
      this.directoryTouched = true;
      cx.notify();
    });
    this.reset(null);
  }

  /** Creating a room, or (with `room`) changing it. */
  get settings() {
    return this.room != null;
  }

  reset(room) {
    this.room = room;
    this.selected = room == null ? [] : [...(room.memberIds ?? [])];
    this.busy = false;
    this.error = null;
    this.allowHomeCwd = false;
    this.needsHomeConfirm = false;
    this.confirmDelete = false;
    this.directoryTouched = room != null;
  }

  open(cx, room, chats) {
    this.reset(room);
    this.nameInput.set_value(room?.name ?? "");
    this.suppressTouch(() => this.directoryInput.set_value(room?.directory ?? ""));
    if (room == null && this.selected.length === 0) this.suggestDirectory(chats);
    cx.notify();
  }

  /** `set_value` fires `change`, which would count as the person typing: not for our own writes. */
  suppressTouch(write) {
    const before = this.directoryTouched;
    write();
    this.directoryTouched = before;
  }

  suggestDirectory(chats) {
    if (this.directoryTouched) return;
    const folder = commonDirectory(chats, this.selected);
    this.suppressTouch(() => this.directoryInput.set_value(folder));
  }

  current() {
    return { name: this.nameInput.value(), selected: this.selected, directory: this.directoryInput.value(), allowHomeCwd: this.allowHomeCwd };
  }

  toggle(id, chats, cx) {
    this.selected = toggleMember(this.selected, id);
    this.error = null;
    if (!this.settings) this.suggestDirectory(chats);
    cx.notify();
  }

  chooseFolder(cx) {
    cx.spawn(async (cx) => {
      try {
        const folder = await pickFolder({ prompt: "Use this folder" });
        if (folder != null) {
          this.directoryInput.set_value(folder);
          this.directoryTouched = true;
          this.needsHomeConfirm = false;
          this.allowHomeCwd = false;
        }
      } catch (error) {
        this.error = describeRoomError(error);
      }
      cx.notify();
    });
  }

  submit(cx) {
    if (this.busy) return;
    const form = this.current();
    if (!canSubmitRoom(form)) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const roomId = this.settings ? await this.#save(form) : (await this.client().request("room.create", roomCreateParams(form))).chat.id;
        this.busy = false;
        this.onDone(roomId, cx);
        return;
      } catch (error) {
        this.error = describeRoomError(error);
        if (error?.code === "home_cwd_requires_confirmation") this.needsHomeConfirm = true;
      }
      this.busy = false;
      cx.notify();
    });
  }

  /** Applies only what changed, one call each; if one fails the ones before it have already taken effect. */
  async #save(form) {
    const client = this.client();
    const room = this.room;
    if (form.name.trim() !== room.name) await client.request("chat.updateProfile", { chatId: room.id, name: form.name.trim() });
    const members = [...form.selected].sort().join();
    if (members !== [...(room.memberIds ?? [])].sort().join()) await client.request("room.setMembers", { roomId: room.id, memberIds: form.selected });
    if (form.directory.trim() !== (room.directory ?? "")) {
      await client.request("room.setDirectory", { roomId: room.id, directory: form.directory.trim() === "" ? null : form.directory.trim(), ...(form.allowHomeCwd ? { allowHomeCwd: true } : {}) });
    }
    return room.id;
  }

  /** Two clicks: the first asks, the second deletes. The bots stay; only the room and its transcript go. */
  remove(cx) {
    if (this.busy || this.room == null) return;
    if (!this.confirmDelete) {
      this.confirmDelete = true;
      cx.notify();
      return;
    }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await this.client().request("chat.delete", { chatIds: [this.room.id] });
        this.busy = false;
        this.onDeleted(cx);
        return;
      } catch (error) {
        this.error = describeRoomError(error);
        this.confirmDelete = false;
      }
      this.busy = false;
      cx.notify();
    });
  }

  // ---- drawing ----------------------------------------------------------------------------------

  /** Bots that can be picked: the ones that can join, plus (when changing a room) members that no longer qualify, so they can be removed. */
  candidates(chats) {
    const eligible = eligibleBots(chats);
    if (!this.settings) return eligible;
    const extra = chats.filter((chat) => chat.kind === "bot" && this.selected.includes(chat.id) && !eligible.includes(chat));
    return [...eligible, ...extra];
  }

  memberRow(t, chat, chats) {
    const on = this.selected.includes(chat.id);
    const full = !on && this.selected.length >= MAX_ROOM_MEMBERS;
    const role = roleOf(chat);
    return h_flex()
      .id(`member-${chat.id}`)
      .px(10)
      .py(6)
      .gap(10)
      .rounded(8)
      .items_center()
      .when(!full, (el) => el.cursor_pointer().hover((hover) => hover.bg(t.hover)).on_click((_event, cx) => this.toggle(chat.id, chats, cx)))
      .when(on, (el) => el.bg(t.selected))
      .child(checkbox(t, on, full))
      .child(avatar(t, chat.name, 24))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(div().truncate().text_size(12.5).font_semibold().text_color(full ? t.dim : t.foreground).child(chat.name))
          .child(div().truncate().text_size(11).text_color(t.muted).child(role.length > 0 ? role : chat.bot?.provider ?? "Bot")),
      )
      .child(div().text_size(11).text_color(statusOf(chat) === "blocked" ? t.blocked : t.muted).child(statusOf(chat)));
  }

  render(t, chats) {
    const form = this.current();
    const ready = canSubmitRoom(form) && (!this.settings || roomChanged(this.room, form));
    const list = this.candidates(chats);
    const count = this.selected.length;
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
          .child(div().id("room-back").px(8).h(26).rounded(6).flex().items_center().cursor_pointer().text_size(14).text_color(t.muted).hover((el) => el.bg(t.hover)).on_click((_event, cx) => this.onCancel(cx)).child("‹"))
          .child(div().flex_1().text_size(13).font_semibold().child(this.settings ? "Room settings" : "New room")),
      )
      .child(
        v_flex()
          .id("room-body")
          .flex_1()
          .min_h(0)
          .overflow_y_scroll()
          .p(14)
          .gap(14)
          .child(v_flex().gap(6).child(heading(t, "Name")).child(field(t, this.nameInput)))
          .child(
            v_flex()
              .gap(6)
              .child(h_flex().items_center().child(div().flex_1().child(heading(t, "Bots in the room"))).child(div().text_size(11).text_color(count >= MIN_ROOM_MEMBERS ? t.muted : t.blocked).child(`${count} of ${MAX_ROOM_MEMBERS}${count < MIN_ROOM_MEMBERS ? ` · pick at least ${MIN_ROOM_MEMBERS}` : ""}`)))
              .child(
                list.length === 0
                  ? div().text_size(12).text_color(t.muted).child("There are no bots to add yet. Create at least two bots first, then make a room.")
                  : v_flex().id("room-members").max_h(240).overflow_y_scroll().gap(2).children(list.map((chat) => this.memberRow(t, chat, chats))),
              ),
          )
          .child(
            v_flex()
              .gap(6)
              .child(heading(t, "Folder"))
              .child(h_flex().gap(8).items_center().child(div().flex_1().min_w(0).child(field(t, this.directoryInput))).child(this.button(t, "room-choose-folder", "Choose…", false, (_event, cx) => this.chooseFolder(cx))))
              .child(div().text_size(11).text_color(t.dim).child("Every bot in the room is told to work in this folder. A bot's own starting folder does not change.")),
          ),
      )
      .when(Boolean(this.error), (el) => el.child(div().px(14).py(6).text_size(11.5).text_color(t.blocked).child(this.error)))
      .when(this.needsHomeConfirm, (el) => el.child(h_flex().px(14).pb(6).child(this.button(t, "room-allow-home", "Use my home folder anyway", false, (_event, cx) => {
        this.allowHomeCwd = true;
        this.needsHomeConfirm = false;
        this.submit(cx);
      }))))
      .child(
        h_flex()
          .flex_none()
          .p(12)
          .gap(8)
          .items_center()
          .border_t(1)
          .border_color(t.border)
          .when(this.settings, (el) => el.child(this.button(t, "room-delete", this.confirmDelete ? "Really delete?" : "Delete room", false, (_event, cx) => this.remove(cx), this.busy)))
          .child(div().flex_1())
          .child(this.button(t, "room-cancel", "Cancel", false, (_event, cx) => this.onCancel(cx)))
          .child(this.button(t, "room-save", this.busy ? "Saving…" : this.settings ? "Save" : "Create", true, (_event, cx) => this.submit(cx), !ready || this.busy)),
      );
  }
}
