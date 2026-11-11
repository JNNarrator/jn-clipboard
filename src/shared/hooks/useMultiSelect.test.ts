import { describe, expect, test } from "vitest";
import { applyMultiToggle } from "./useMultiSelect";

const sel = (...ids: number[]) => new Set(ids);

describe("applyMultiToggle", () => {
  test("plain toggle adds and removes, moving the anchor", () => {
    let r = applyMultiToggle(sel(), 11, [], null, false);
    expect([...r.next]).toEqual([11]);
    expect(r.nextAnchor).toBe(11);

    r = applyMultiToggle(r.next, 12, [], 11, false);
    expect([...r.next].sort()).toEqual([11, 12]);
    expect(r.nextAnchor).toBe(12);

    r = applyMultiToggle(r.next, 11, [], 12, false);
    expect([...r.next]).toEqual([12]);
    expect(r.nextAnchor).toBe(11);
  });

  test("range picks the visible-order span between anchor and click", () => {
    const order = [5, 6, 7, 8];
    const r = applyMultiToggle(sel(6), 8, order, 6, true);
    expect([...r.next].sort()).toEqual([6, 7, 8]);
    expect(r.nextAnchor).toBe(6);
  });

  test("an overlapping range joins instead of clobbering", () => {
    const order = [5, 6, 7, 8];
    let r = applyMultiToggle(sel(6), 8, order, 6, true); // 6,7,8
    r = applyMultiToggle(r.next, 5, order, 6, true); // extend down to 5
    expect([...r.next].sort()).toEqual([5, 6, 7, 8]);
  });

  test("range with no anchor degrades to a plain toggle", () => {
    const r = applyMultiToggle(sel(), 5, [5, 6], null, true);
    expect([...r.next]).toEqual([5]);
    expect(r.nextAnchor).toBe(5);
  });

  test("range whose ids are outside the order degrades, never throws", () => {
    const r = applyMultiToggle(sel(1), 99, [1, 2, 3], 1, true);
    expect(r.nextAnchor).toBe(99); // fell through to plain toggle
    expect([...r.next].sort()).toEqual([1, 99]);
  });

  test("range can also deselect when nothing was selected in the span", () => {
    // Selecting a range always adds; a plain toggle on a selected id removes.
    const order = [1, 2, 3];
    expect([...applyMultiToggle(sel(1, 2), 2, order, null, false).next]).toEqual([1]);
  });
});
