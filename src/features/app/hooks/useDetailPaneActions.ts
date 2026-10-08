import { useMemo, type Dispatch, type MouseEvent, type RefObject, type SetStateAction } from "react";
import type { ClipboardEntry } from "../../../shared/types";
import type { VirtualClipboardListHandle } from "../../clipboard/types";
import type { DetailPaneActions } from "../../clipboard/components/ClipboardDetailPane";

interface UseDetailPaneActionsOptions {
  /** Entries in display order, to pick the neighbour after a delete. */
  items: ClipboardEntry[];
  focusDetailItem: (id: number) => void;
  copyToClipboard: (
    id: number,
    content: string,
    contentType: string,
    pasteWithFormat?: boolean,
    isPinned?: boolean,
    tags?: string[]
  ) => Promise<void>;
  openContent: (item: ClipboardEntry) => void;
  togglePin: (event: MouseEvent, id: number, isPinned: boolean) => void;
  deleteEntry: (event: MouseEvent, id: number) => void;
  handleAIAction: (id: number, content: string, actionType: string) => void;
  setEditingTagsId: Dispatch<SetStateAction<number | null>>;
  setEditingNoteId: Dispatch<SetStateAction<number | null>>;
  setTagInput: Dispatch<SetStateAction<string>>;
  setRevealedIds: Dispatch<SetStateAction<Set<number>>>;
  virtualListRef: RefObject<VirtualClipboardListHandle | null>;
}

/** The detail pane's action bar runs the same operations a list card offers. */
export const useDetailPaneActions = ({
  items,
  focusDetailItem,
  copyToClipboard,
  openContent,
  togglePin,
  deleteEntry,
  handleAIAction,
  setEditingTagsId,
  setEditingNoteId,
  setTagInput,
  setRevealedIds,
  virtualListRef
}: UseDetailPaneActionsOptions): DetailPaneActions =>
  useMemo(() => {
    // Tag and note editors open inside the list card, so bring that card into
    // view; it may have scrolled away or moved (e.g. just pinned).
    const revealRow = (item: ClipboardEntry) => {
      const row = document.getElementById(`clipboard-item-${item.id}`);
      if (row) {
        row.scrollIntoView({ block: "nearest" });
        return;
      }
      // Off-screen unpinned rows are virtualized; pinned ones sit in the header.
      const unpinned = items.filter((entry) => !entry.is_pinned);
      const index = unpinned.findIndex((entry) => entry.id === item.id);
      if (index >= 0) virtualListRef.current?.scrollToItem(index);
    };

    return {
      paste: (item) =>
        void copyToClipboard(item.id, item.content, item.content_type, false, item.is_pinned, item.tags || []),
      togglePin: (event, item) => togglePin(event, item.id, item.is_pinned),
      // The editors stay in the list card; the pane only opens and closes them.
      setTagEditor: (item, open) => {
        setEditingNoteId(null);
        setTagInput("");
        setEditingTagsId(open ? item.id : null);
        if (open) revealRow(item);
      },
      setNoteEditor: (item, open) => {
        setEditingTagsId(null);
        setTagInput("");
        setEditingNoteId(open ? item.id : null);
        if (open) revealRow(item);
      },
      runAI: (item, actionType) => handleAIAction(item.id, item.content, actionType),
      open: (item) => openContent(item),
      toggleReveal: (item) =>
        setRevealedIds((prev) => {
          const next = new Set(prev);
          if (next.has(item.id)) next.delete(item.id);
          else next.add(item.id);
          return next;
        }),
      // Move to the next row first so repeated deletes walk down the list
      // instead of jumping back to the top.
      remove: (event, item) => {
        const index = items.findIndex((entry) => entry.id === item.id);
        const neighbour = index >= 0 ? (items[index + 1] ?? items[index - 1]) : undefined;
        if (neighbour) focusDetailItem(neighbour.id);
        deleteEntry(event, item.id);
      }
    };
  }, [
    items,
    focusDetailItem,
    copyToClipboard,
    openContent,
    togglePin,
    deleteEntry,
    handleAIAction,
    setEditingTagsId,
    setEditingNoteId,
    setTagInput,
    setRevealedIds,
    virtualListRef
  ]);
