import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { ClipboardEntry } from "../types";
import type { VirtualClipboardListHandle } from "../../features/clipboard/types";
import { reconcileHistoryTags } from "../lib/historyState";

interface UseClipboardActionsOptions {
  t: (key: string) => string;
  pushToast: (msg: string, duration?: number, action?: import("../types").ToastAction) => number;
  deleteAfterPaste: boolean;
  moveToTopAfterPaste: boolean;
  /** Clicking (or Enter on) an item only copies it; the user pastes (#175). */
  clickCopyOnly: boolean;
  isWindowPinned: boolean;
  setSearch: (val: string) => void;
  setHistory: Dispatch<SetStateAction<ClipboardEntry[]>>;
  virtualListRef: RefObject<VirtualClipboardListHandle | null>;
  /** Latest history without entering the deps of deleteEntryById. */
  historyRef: RefObject<ClipboardEntry[]>;
  /** Refetch after an undo restored a row out-of-band. */
  fetchHistory: () => void;
}

// Files and media are read by id on the backend; sending their content is waste.
const invokeContentFor = (id: number, content: string, contentType: string) =>
  id !== 0 && (contentType === "image" || contentType === "video" || contentType === "file")
    ? ""
    : content;

export const useClipboardActions = ({
  t,
  pushToast,
  deleteAfterPaste,
  moveToTopAfterPaste,
  clickCopyOnly,
  isWindowPinned,
  setSearch,
  setHistory,
  virtualListRef,
  historyRef,
  fetchHistory
}: UseClipboardActionsOptions) => {
  const copyToClipboard = useCallback(
    async (
      id: number,
      content: string,
      contentType: string,
      pasteWithFormat = true,
      isPinned = false,
      tags: string[] = []
    ) => {
      try {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }

        const invokeContent = invokeContentFor(id, content, contentType);

        if (clickCopyOnly) {
          await invoke("copy_to_clipboard", {
            content: invokeContent,
            contentType,
            paste: false,
            id: id,
            deleteAfterUse: false,
            pasteWithFormat,
            moveToTop: false
          });
          setSearch("");
          // Out of the way so the user can paste where they want; a pinned
          // window stays, so confirm instead.
          if (isWindowPinned) {
            pushToast(t("copied_to_clipboard"), 1500);
          } else {
            await invoke("hide_window_cmd");
          }
          return;
        }

        const shouldDelete = deleteAfterPaste && !isPinned && tags.length === 0;
        await invoke("copy_to_clipboard", {
          content: invokeContent,
          contentType,
          paste: true,
          id: id,
          deleteAfterUse: shouldDelete,
          pasteWithFormat,
          moveToTop: moveToTopAfterPaste
        });

        if (moveToTopAfterPaste && !shouldDelete) {
          const now = Date.now();
          setHistory((prev) =>
            prev.map((item) =>
              item.id === id
                ? { ...item, timestamp: now, sort_at: now, last_used_at: now }
                : item
            )
          );
        }

        setSearch("");
      } catch (err) {
        // The backend event opens the actionable permission dialog.
        if (String(err).includes("accessibility_permission_required")) return;
        const errorMsg = t("copy_failed") + (err?.toString() || "");
        pushToast(errorMsg, 3000);
      }
    },
    [clickCopyOnly, deleteAfterPaste, isWindowPinned, moveToTopAfterPaste, pushToast, setHistory, setSearch, t]
  );

  // Shift+Enter: put the entry on the clipboard and keep the window open, so
  // the user can go on browsing (unlike 「点击只复制」, which hides it).
  const copyWithoutPaste = useCallback(
    async ({ id, content, content_type }: ClipboardEntry) => {
      try {
        await invoke("copy_to_clipboard", {
          content: invokeContentFor(id, content, content_type),
          contentType: content_type,
          paste: false,
          id,
          deleteAfterUse: false,
          pasteWithFormat: true,
          moveToTop: false
        });
        pushToast(t("copied_to_clipboard"), 1500);
      } catch (err) {
        pushToast(t("copy_failed") + (err?.toString() || ""), 3000);
      }
    },
    [pushToast, t]
  );

  const openContent = useCallback(
    async (item: ClipboardEntry) => {
      try {
        await invoke("open_content", {
          id: item.id,
          content: item.content,
          contentType: item.content_type
        });
      } catch (err) {
        const errorMsg = String(err).includes("file_missing")
          ? t("open_file_missing")
          : t("open_failed") + (err?.toString() || "");
        pushToast(errorMsg, 3000);
      }
    },
    [pushToast, t]
  );

  const deleteEntryById = useCallback(
    async (id: number): Promise<boolean> => {
      // Snapshot before the row vanishes: text kinds restore losslessly via
      // add_manual_item + tag/note/pin write-back. Image/video/file rows are
      // not offered an undo — the backend already swept their attachment
      // files by the time a toast could run, and a restored row with a dead
      // path is worse than no row.
      const snapshot = historyRef.current.find((item) => item.id === id);
      const restorable =
        !!snapshot &&
        snapshot.id > 0 &&
        ["text", "code", "url", "rich_text"].includes(snapshot.content_type);
      try {
        await invoke("delete_clipboard_entry", { id });
        setHistory((prev) => prev.filter((item) => item.id !== id));
        if (restorable && snapshot) {
          pushToast(t("entry_deleted"), 5000, {
            label: t("undo"),
            onClick: () => {
              void (async () => {
                try {
                  const newId = await invoke<number>("add_manual_item", {
                    content: snapshot.content,
                    contentType: snapshot.content_type,
                    tags: snapshot.tags ?? [],
                  });
                  // add_manual_item stamps "now" and Manual as source; put
                  // the entry's own identity back where it can be.
                  if (snapshot.note) {
                    await invoke("update_entry_note", { id: newId, note: snapshot.note });
                  }
                  if (snapshot.is_pinned) {
                    await invoke("toggle_clipboard_pin", { id: newId, isPinned: true });
                  }
                  pushToast(t("entry_restored"), 2500);
                  fetchHistory();
                } catch {
                  pushToast(t("restore_failed"), 3000);
                }
              })();
            },
          });
        }
        return true;
      } catch (err) {
        const errorMsg = t("delete_failed") + ": " + (err?.toString() || "");
        pushToast(errorMsg, 3000);
        return false;
      }
    },
    [fetchHistory, historyRef, pushToast, setHistory, t]
  );

  const deleteEntry = useCallback(
    async (e: ReactMouseEvent, id: number) => {
      e.stopPropagation();
      await deleteEntryById(id);
    },
    [deleteEntryById]
  );

  const togglePin = useCallback(
    async (e: ReactMouseEvent, id: number, currentPinned: boolean) => {
      e.stopPropagation();
      try {
        await invoke("toggle_clipboard_pin", { id, isPinned: !currentPinned });
        const now = Date.now();
        setHistory((prev) =>
          prev
            .map((item) =>
              item.id === id
                ? { ...item, is_pinned: !currentPinned, timestamp: now, sort_at: now }
                : item
            )
            .sort((a, b) => {
              if (a.is_pinned === b.is_pinned) {
                return (b.sort_at || b.timestamp) - (a.sort_at || a.timestamp);
              }
              return a.is_pinned ? -1 : 1;
            })
        );
      } catch (err) {
        const errorMsg =
          (currentPinned ? t("unpin_failed") : t("pin_failed")) + ": " + (err?.toString() || "");
        pushToast(errorMsg, 3000);
      }
    },
    [pushToast, setHistory, t]
  );

  const handleUpdateTags = useCallback(
    async (id: number, newTags: string[]) => {
      try {
        const newId = await invoke<number>("update_tags", { id, tags: newTags });
        setHistory((prev) =>
          reconcileHistoryTags(prev, id, newId, newTags)
        );

        setTimeout(() => {
          if (virtualListRef.current) {
            virtualListRef.current.resetAfterIndex(0);
          }
        }, 0);
      } catch (err) {
        console.error("更新标签失败", err);
        pushToast(t("save_tags_failed") + String(err), 4000);
      }
    },
    [pushToast, setHistory, t, virtualListRef]
  );

  const handleUpdateNote = useCallback(
    async (id: number, note: string) => {
      const cleaned = note.trim();
      try {
        await invoke("update_entry_note", { id, note: cleaned });
        setHistory((prev) =>
          prev.map((item) => (item.id === id ? { ...item, note: cleaned } : item))
        );
        setTimeout(() => {
          if (virtualListRef.current) {
            virtualListRef.current.resetAfterIndex(0);
          }
        }, 0);
      } catch (err) {
        console.error("更新备注失败", err);
        pushToast(t("save_note_failed") + String(err), 4000);
      }
    },
    [pushToast, setHistory, t, virtualListRef]
  );

  return {
    copyToClipboard,
    copyWithoutPaste,
    openContent,
    deleteEntry,
    deleteEntryById,
    togglePin,
    handleUpdateTags,
    handleUpdateNote
  };
};
