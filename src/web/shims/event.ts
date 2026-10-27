/**
 * Browser stand-in for `@tauri-apps/api/event`.
 *
 * On the desktop build these are the Rust event bus (`app.emit`, `listen` from
 * Rust, window-to-window delivery). In the browser there is a single window, so
 * a plain in-page bus is behaviourally equivalent: `emit` reaches every
 * `listen` subscriber, just without crossing a process boundary.
 */
export type UnlistenFn = () => void;

export interface Event<T> {
  event: string;
  id: number;
  payload: T;
}

type Handler = (event: Event<unknown>) => void;

const handlers = new Map<string, Set<Handler>>();
let nextListenerId = 1;
const listenerIds = new WeakMap<Handler, number>();

function subscribe<T>(name: string, handler: (event: Event<T>) => void): UnlistenFn {
  const entry = handler as unknown as Handler;
  if (!listenerIds.has(entry)) listenerIds.set(entry, nextListenerId++);
  let bucket = handlers.get(name);
  if (!bucket) {
    bucket = new Set();
    handlers.set(name, bucket);
  }
  bucket.add(entry);
  return () => {
    const current = handlers.get(name);
    if (!current) return;
    current.delete(entry);
    if (current.size === 0) handlers.delete(name);
  };
}

export async function listen<T>(
  name: string,
  handler: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  return subscribe(name, handler);
}

export async function once<T>(
  name: string,
  handler: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  const off = subscribe<T>(name, (event) => {
    off();
    handler(event);
  });
  return off;
}

/** Fire an event to this page. Mirrors `emit` from the Tauri API. */
export async function emit<T>(name: string, payload?: T): Promise<void> {
  dispatchLocal(name, payload);
}

/** Targets are window labels on desktop; with one window this is `emit`. */
export async function emitTo<T>(_target: string, name: string, payload?: T): Promise<void> {
  dispatchLocal(name, payload);
}

/**
 * Deliver an event synchronously. Used by the web backend to push
 * `clipboard-changed`-style notifications the Rust side would have emitted.
 */
export function dispatchLocal<T>(name: string, payload?: T): void {
  const bucket = handlers.get(name);
  if (!bucket) return;
  const event: Event<T | undefined> = { event: name, id: listenerIds.get(bucket.values().next().value as Handler) ?? 0, payload };
  // Copy first: a handler may unsubscribe while we iterate.
  for (const handler of [...bucket]) {
    try {
      handler(event as Event<unknown>);
    } catch (error) {
      console.error(`[web] listener for "${name}" threw`, error);
    }
  }
}
