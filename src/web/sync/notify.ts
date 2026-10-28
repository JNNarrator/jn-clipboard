/**
 * Tell the UI that a sync changed something.
 *
 * The list refreshes on the same `clipboard-changed` event the web backend
 * emits after a capture, so a clip that arrived from another device appears
 * without the user having to touch anything. Kept out of the engine so the
 * engine stays testable in plain Node, where there is no event bus.
 */
import { dispatchLocal } from "../shims/event";
import type { SyncOutcome } from "./engine";

export function notifyIfChanged(outcome: SyncOutcome): void {
  if (outcome.pulled > 0) dispatchLocal("clipboard-changed", undefined);
}
