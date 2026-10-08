import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { ClipboardEntry } from "../../../shared/types";
import { useWideWindow } from "../../../shared/hooks/useWideWindow";

const ITEM_ID_PREFIX = "clipboard-item-";
/** How long the pointer must rest on a row before the pane switches to it. */
const HOVER_DWELL_MS = 100;

interface UseSplitViewOptions {
  enabled: boolean;
  /** Only the history list gets a detail pane (not settings, tags, emoji, transfer). */
  listVisible: boolean;
  /** Entries in display order (pinned first). */
  items: ClipboardEntry[];
  selectedItemId: number | null;
  isKeyboardMode: boolean;
  /** Entry with an open tag/note editor; the pane stays on it meanwhile. */
  lockedId: number | null;
}

export const useSplitView = ({ enabled, listVisible, items, selectedItemId, isKeyboardMode, lockedId }: UseSplitViewOptions) => {
  const isWide = useWideWindow();
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const dwellRef = useRef<{ id: number | null; timer: number }>({ id: null, timer: 0 });

  useEffect(() => {
    const dwell = dwellRef.current;
    return () => window.clearTimeout(dwell.timer);
  }, []);

  const active = enabled && isWide && listVisible;

  // Lets CSS and the compact hover preview know the detail pane is showing.
  useEffect(() => {
    document.body.classList.toggle("split-view-active", active);
    document.documentElement.classList.toggle("split-view-active", active);
  }, [active]);

  // Keyboard navigation drives the pane while the arrow keys are in use.
  useEffect(() => {
    if (isKeyboardMode && selectedItemId != null) setFocusedId(selectedItemId);
  }, [isKeyboardMode, selectedItemId]);

  // Mouse hover drives it otherwise, but only once the pointer rests on a row:
  // sweeping diagonally over other rows on the way to the pane's action bar
  // must not retarget it. One delegated listener on the list column.
  const handleListMouseOver = useCallback((event: MouseEvent<HTMLElement>) => {
    const row = (event.target as HTMLElement).closest?.(`[id^="${ITEM_ID_PREFIX}"]`);
    if (!row) return;
    const id = Number(row.id.slice(ITEM_ID_PREFIX.length));
    const dwell = dwellRef.current;
    if (!Number.isFinite(id) || dwell.id === id) return;
    window.clearTimeout(dwell.timer);
    dwell.id = id;
    dwell.timer = window.setTimeout(() => setFocusedId(id), HOVER_DWELL_MS);
  }, []);

  const handleListMouseLeave = useCallback(() => {
    const dwell = dwellRef.current;
    window.clearTimeout(dwell.timer);
    dwell.id = null;
  }, []);

  const detailItem = useMemo(() => {
    if (!active || items.length === 0) return null;
    const targetId = lockedId ?? focusedId;
    return items.find((item) => item.id === targetId) ?? items[0];
  }, [active, items, focusedId, lockedId]);

  return {
    splitActive: active,
    detailItem,
    handleListMouseOver,
    handleListMouseLeave,
    focusDetailItem: setFocusedId
  };
};
