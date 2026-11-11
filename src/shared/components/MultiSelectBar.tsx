import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tag, Trash2, X } from "lucide-react";
import type { ClipboardEntry } from "../types";

/**
 * The action strip while rows are multi-selected. Sits above the list, sizes
 * to one line, and clears itself on Escape — a bulk action should feel like a
 * quick aside, not a mode you have to remember to leave.
 */
export default function MultiSelectBar({
  entries,
  t,
  pushToast,
  onClear,
  onChanged,
}: {
  entries: ClipboardEntry[];
  t: (key: string, ...args: string[]) => string;
  pushToast: (msg: string, duration?: number, action?: import("../types").ToastAction) => number;
  onClear: () => void;
  /** Refetch after a bulk change landed. */
  onChanged: () => void;
}) {
  const fill = (key: string, n: number) => t(key).replace("{n}", String(n));
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClear]);

  if (entries.length === 0) return null;

  const restorable = entries.filter((e) =>
    ["text", "code", "url", "rich_text"].includes(e.content_type)
  );
  const canUndo = restorable.length === entries.length;

  const confirmDelete = () => {
    void (async () => {
      setBusy(true);
      const deleted: ClipboardEntry[] = [];
      try {
        // Sequential, not racing: SQLite likes one writer, and a partial
        // failure should still be undoable for the rows that did go.
        for (const entry of entries) {
          await invoke("delete_clipboard_entry", { id: entry.id });
          deleted.push(entry);
        }
        onClear();
        onChanged();
        if (canUndo && deleted.length > 0) {
          pushToast(fill("entries_deleted", deleted.length), 6000, {
            label: t("undo"),
            onClick: () => {
              void (async () => {
                try {
                  for (const entry of deleted) {
                    const newId = await invoke<number>("add_manual_item", {
                      content: entry.content,
                      contentType: entry.content_type,
                      tags: entry.tags ?? [],
                    });
                    if (entry.note) {
                      await invoke("update_entry_note", { id: newId, note: entry.note });
                    }
                    if (entry.is_pinned) {
                      await invoke("toggle_clipboard_pin", { id: newId, isPinned: true });
                    }
                  }
                  pushToast(t("entry_restored"), 2500);
                  onChanged();
                } catch {
                  pushToast(t("restore_failed"), 3000);
                }
              })();
            },
          });
        } else {
          pushToast(fill("entries_deleted", deleted.length), 3000);
        }
      } catch (err) {
        pushToast(t("delete_failed") + ": " + String(err), 3000);
        onChanged();
      } finally {
        setBusy(false);
      }
    })();
  };

  const addTagToAll = () => {
    const tag = tagDraft.trim();
    if (!tag) {
      inputRef.current?.focus();
      return;
    }
    void (async () => {
      setBusy(true);
      try {
        for (const entry of entries) {
          const tags = new Set(entry.tags ?? []);
          tags.add(tag);
          const newId = await invoke<number>("update_tags", {
            id: entry.id,
            tags: [...tags],
          });
          // update_tags may emit a new id for the merged row; the refetch
          // below reconciles whatever changed.
          void newId;
        }
        setTagDraft("");
        pushToast(fill("tag_applied_to", entries.length), 2500);
        onChanged();
      } catch (err) {
        pushToast(t("save_tags_failed") + String(err), 3000);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="multi-select-bar" role="toolbar" aria-label={t("multi_select_bar")}>
      <span className="multi-select-count">{fill("multi_selected_count", entries.length)}</span>
      <div className="multi-select-tag-input">
        <Tag size={12} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={tagDraft}
          placeholder={t("multi_add_tag")}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTagToAll();
            }
          }}
          spellCheck={false}
          disabled={busy}
        />
        <button
          type="button"
          className="settings-action-button settings-action-button--small"
          onClick={addTagToAll}
          disabled={busy}
        >
          {t("multi_apply_tag")}
        </button>
      </div>
      <button
        type="button"
        className="multi-select-delete"
        onClick={confirmDelete}
        disabled={busy}
      >
        <Trash2 size={13} aria-hidden="true" />
        {t("multi_delete")}
      </button>
      <button
        type="button"
        className="multi-select-exit"
        onClick={onClear}
        aria-label={t("multi_cancel")}
        title={t("multi_cancel")}
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
