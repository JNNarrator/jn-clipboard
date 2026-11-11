import { useCallback, useMemo, useRef, useState } from "react";
import type { ClipboardEntry } from "../types";

/**
 * Cmd-click / checkbox multi-select over the ordered list the UI renders.
 * Pure logic (kept out of React for testing) plus a thin stateful wrapper.
 */

/** Apply one toggle to a selection. Range uses the visible order. */
export function applyMultiToggle(
  selected: Set<number>,
  id: number,
  order: number[],
  anchorId: number | null,
  range: boolean
): { next: Set<number>; nextAnchor: number | null } {
  if (range && anchorId != null && order.length > 0) {
    const from = order.indexOf(anchorId);
    const to = order.indexOf(id);
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      const next = new Set(selected);
      // Shift extends the selection: overlaps join, they do not clobber.
      for (let i = lo; i <= hi; i += 1) next.add(order[i]);
      return { next, nextAnchor: anchorId };
    }
  }
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { next, nextAnchor: id };
}

export function useMultiSelect() {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  /** Row id the next Shift-click ranges from. */
  const anchorIdRef = useRef<number | null>(null);
  /** Row ids in the order the list renders them (pinned first, like the UI). */
  const orderRef = useRef<number[]>([]);

  const setOrder = useCallback((ids: number[]) => {
    orderRef.current = ids;
  }, []);

  const toggle = useCallback((id: number, opts?: { range?: boolean }) => {
    let size = -1;
    setSelectedIds((prev) => {
      const { next, nextAnchor } = applyMultiToggle(
        prev,
        id,
        orderRef.current,
        anchorIdRef.current,
        opts?.range ?? false
      );
      anchorIdRef.current = nextAnchor;
      size = next.size;
      return next;
    });
    return size;
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    anchorIdRef.current = null;
  }, []);

  const selectMany = useCallback((entries: ClipboardEntry[]) => {
    setSelectedIds(new Set(entries.map((e) => e.id)));
    if (entries.length > 0) anchorIdRef.current = entries[entries.length - 1].id;
  }, []);

  const isEmpty = selectedIds.size === 0;

  return useMemo(
    () => ({ selectedIds, isEmpty, toggle, clear, selectMany, setOrder }),
    [selectedIds, isEmpty, toggle, clear, selectMany, setOrder]
  );
}

export type MultiSelect = ReturnType<typeof useMultiSelect>;

/** Convenience for the caller: ids in rendered order. */
export function renderOrderOf(
  pinnedItems: ClipboardEntry[],
  unpinnedItems: ClipboardEntry[]
): number[] {
  return [...pinnedItems, ...unpinnedItems].map((item) => item.id);
}
