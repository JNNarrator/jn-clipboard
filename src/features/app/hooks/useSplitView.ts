import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import type { ClipboardEntry } from "../../../shared/types";

/** Window width (CSS px) at which the list gains a detail pane. */
export const SPLIT_VIEW_MIN_WIDTH = 640;
const ITEM_ID_PREFIX = "clipboard-item-";

interface UseSplitViewOptions {
  enabled: boolean;
  /** Only the history list gets a detail pane (not settings, tags, emoji, transfer). */
  listVisible: boolean;
  items: ClipboardEntry[];
  selectedItemId: number | null;
  isKeyboardMode: boolean;
}

const isWideNow = () => typeof window !== "undefined" && window.innerWidth >= SPLIT_VIEW_MIN_WIDTH;

export const useSplitView = ({ enabled, listVisible, items, selectedItemId, isKeyboardMode }: UseSplitViewOptions) => {
  const [isWide, setIsWide] = useState(isWideNow);
  const [focusedId, setFocusedId] = useState<number | null>(null);

  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setIsWide(isWideNow()));
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
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

  // Mouse hover drives it otherwise; one delegated listener on the list column.
  const handleListMouseOver = useCallback((event: MouseEvent<HTMLElement>) => {
    const row = (event.target as HTMLElement).closest?.(`[id^="${ITEM_ID_PREFIX}"]`);
    if (!row) return;
    const id = Number(row.id.slice(ITEM_ID_PREFIX.length));
    if (Number.isFinite(id)) setFocusedId((prev) => (prev === id ? prev : id));
  }, []);

  const detailItem = useMemo(() => {
    if (!active || items.length === 0) return null;
    return items.find((item) => item.id === focusedId) ?? items[0];
  }, [active, items, focusedId]);

  return { splitActive: active, detailItem, handleListMouseOver };
};
