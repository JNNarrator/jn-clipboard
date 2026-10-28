/**
 * Command dispatch for the web build — the counterpart of Tauri's `invoke`.
 *
 * The shared UI calls `invoke("get_clipboard_history", …)` and friends. Here
 * those names resolve to functions over IndexedDB (or to deliberate no-ops for
 * anything that is inherently native: hotkeys, tray, window pinning, file
 * managers). An unknown command resolves `null` with one console warning rather
 * than throwing: a missing optional feature must not blank the whole app.
 */
import { dispatchLocal } from "../shims/event";
import { getAllSettings, resetSettings, saveSetting } from "./settings";
import {
  captureEntry,
  clearHistory,
  deleteEntry,
  listHistory,
  markUsed,
  searchHistory,
  setContent,
  setNote,
  setPinned,
  setTagColor,
  setTags,
  tagColors,
  updatePinnedOrder,
} from "./history";

type Args = Record<string, unknown>;
type Handler = (args: Args) => unknown;

const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** Notify the shared UI that the history changed, as the Rust side does. */
function changed(): void {
  dispatchLocal("clipboard-changed", undefined);
}

const handlers: Record<string, Handler> = {
  // ---- settings ----------------------------------------------------------
  get_settings: () => getAllSettings(),
  save_setting: async ({ key, value }) => {
    await saveSetting(str(key), str(value));
    return null;
  },
  reset_settings: () => resetSettings(),
  // Nothing on the web build is encrypted, so there is nothing undecryptable.
  get_undecryptable_settings: () => [],
  clear_undecryptable_settings: () => null,

  // ---- history -----------------------------------------------------------
  get_clipboard_history: async ({ limit, offset, contentType, sortMode }) =>
    listHistory(
      num(limit, 200),
      num(offset, 0),
      typeof contentType === "string" && contentType ? contentType : undefined,
      str(sortMode) || undefined,
    ),
  search_clipboard_history: async ({ searchTerm, limit, tagOnly, noteOnly }) =>
    searchHistory({
      searchTerm: str(searchTerm),
      limit: num(limit, 200),
      tagOnly: tagOnly === true,
      noteOnly: noteOnly === true,
    }),
  delete_clipboard_entry: async ({ id }) => {
    await deleteEntry(num(id));
    changed();
    return null;
  },
  clear_clipboard_history: async () => {
    await clearHistory();
    changed();
    return null;
  },
  toggle_clipboard_pin: async ({ id, isPinned }) => {
    await setPinned(num(id), isPinned === true);
    changed();
    return null;
  },
  update_pinned_order: async ({ orders }) => {
    await updatePinnedOrder(Array.isArray(orders) ? (orders as [number, number][]) : []);
    return null;
  },
  update_tags: async ({ id, tags }) => {
    await setTags(num(id), Array.isArray(tags) ? tags.map(str) : []);
    changed();
    return null;
  },
  update_entry_note: async ({ id, note }) => {
    await setNote(num(id), str(note));
    changed();
    return null;
  },
  update_item_content: async ({ id, content }) => {
    await setContent(num(id), str(content));
    changed();
    return null;
  },
  copy_to_clipboard: async ({ content, contentType, id }) => {
    await writeClipboard(str(content), str(contentType) || "text");
    if (num(id, -1) >= 0) await markUsed(num(id));
    changed();
    return null;
  },
  get_tag_colors: () => tagColors(),
  set_tag_color: async ({ name, color }) => {
    await setTagColor(str(name), str(color));
    dispatchLocal("tag-colors-updated", undefined);
    return null;
  },

  // ---- web-only ----------------------------------------------------------
  /** Capture the current clipboard / a pasted payload into the history. */
  web_capture_entry: async ({ content, contentType, htmlContent, sourceApp }) => {
    const id = await captureEntry({
      content: str(content),
      content_type: str(contentType) || "text",
      html_content: typeof htmlContent === "string" ? htmlContent : undefined,
      source_app: str(sourceApp) || "Web",
    });
    changed();
    return id;
  },

  // ---- identity / build info ---------------------------------------------
  get_release_build_info: async () => ({
    version: __APP_VERSION__,
    portable: false,
    channel: "web",
    isWeb: true,
  }),
  /** IndexedDB is the only store; there is no user-chosen data directory. */
  get_data_path: async () => null,
  set_data_path: () => null,

  // ---- deliberately inert ------------------------------------------------
  // Native window, tray, hotkey and OS integrations. Listed explicitly so the
  // console stays quiet about calls that are expected to do nothing, while a
  // genuinely unimplemented command still gets reported.
  acquire_blur_guard: () => null,
  release_blur_guard: () => null,
  main_ui_ready: () => null,
  main_ui_released: () => null,
  set_navigation_enabled: () => null,
  set_navigation_mode: () => null,
  set_window_pinned: () => null,
  focus_clipboard_window: () => null,
  activate_window_focus: () => null,
  activate_app_focus: () => null,
  hide_window_cmd: () => null,
  toggle_window_cmd: () => null,
  configure_compact_preview_window: () => null,
  disable_webview_browser_accelerators: () => null,
  register_hotkey: () => null,
  test_hotkey_available: () => true,
  set_search_hotkey: () => null,
  set_sequential_hotkey: () => null,
  set_plain_paste_hotkey: () => null,
  set_quick_paste_modifier: () => null,
  set_sound_enabled: () => null,
  set_paste_sound_enabled: () => null,
  play_preview_sound: () => null,
  set_capture_files: () => null,
  set_capture_rich_text: () => null,
  set_deduplication: () => null,
  set_persistence: () => null,
  set_recording_mode: () => null,
  set_arrow_key_selection: () => null,
  set_cleanup_rules: () => null,
  set_app_cleanup_policies: () => null,
  set_theme: () => null,
  check_is_admin: () => false,
  check_macos_permissions: () => ({ accessibilty: true, screenCapture: true }),
  request_macos_permissions: () => null,
  open_macos_accessibility_settings: () => null,
  get_macos_accessibility_binary_path: () => null,
  restart_as_admin: () => null,
  is_autostart_enabled: () => false,
  is_elevated_autostart_enabled: () => false,
  restart_explorer: () => null,
  trigger_registry_win_v_optimization: () => null,
  restart_cloud_sync_client: () => null,
  stop_cloud_sync_client: () => null,
  cloud_sync_now: () => null,
  get_cloud_sync_status: () => ({ state: "disabled" }),
  relaunch: () => {
    window.location.reload();
    return null;
  },

  // ---- media / files -----------------------------------------------------
  // Thumbnails, icons and file previews are produced by native code; the web
  // build renders images directly from their data URL instead.
  get_image_thumbnail: () => null,
  get_video_thumbnail: () => null,
  get_file_icon: () => null,
  get_executable_icon: () => null,
  read_text_file_preview: () => null,
  open_content: () => null,
  open_folder: () => null,
  save_file_copy: () => null,
  start_native_drag: () => null,
  scan_installed_apps: () => [],
  get_system_default_app: () => null,
  list_installed_themes: () => [],
  get_installed_theme_css: () => null,
  get_clipboard_content: () => readClipboard(),
  get_clipboard_content_with_html: () => readClipboard(),
};

async function writeClipboard(text: string, contentType: string): Promise<void> {
  if (contentType === "image") {
    // Images are stored as data URLs; hand the browser a real blob so paste
    // targets accept it.
    const blob = await (await fetch(text)).blob();
    const item = new ClipboardItem({ [blob.type]: blob });
    await navigator.clipboard.write([item]);
    return;
  }
  await navigator.clipboard.writeText(text);
}

async function readClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    // Permission denied or not focused; the capture bar still accepts a paste.
    return "";
  }
}

const warned = new Set<string>();

/**
 * The `invoke` replacement. Kept async and generic to match the Tauri signature
 * the call sites are written against.
 */
export async function invokeCommand<T>(command: string, args: Args = {}): Promise<T> {
  const handler = handlers[command];
  if (!handler) {
    if (!warned.has(command)) {
      warned.add(command);
      console.warn(`[web] no implementation for "${command}"; resolving null`);
    }
    return null as T;
  }
  return (await handler(args)) as T;
}

/** Exposed for the capture UI and tests. */
export const webCommands = handlers;
