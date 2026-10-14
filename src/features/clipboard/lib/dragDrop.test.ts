import { test, expect } from "vitest";
import { shouldHideAfterExternalDrop } from "./dragDrop";

test("accepted external drops hide an unpinned window", () => {
  expect(shouldHideAfterExternalDrop("copy", false, false)).toBe(true);
  expect(shouldHideAfterExternalDrop("move", false, false)).toBe(true);
});

test("Escape, rejected drops, internal drops and pinned windows stay visible", () => {
  expect(shouldHideAfterExternalDrop("none", false, false)).toBe(false);
  expect(shouldHideAfterExternalDrop("copy", true, false)).toBe(false);
  expect(shouldHideAfterExternalDrop("copy", false, true)).toBe(false);
});
