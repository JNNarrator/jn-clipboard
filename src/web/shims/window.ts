/**
 * Browser stand-in for `@tauri-apps/api/window`.
 *
 * A web page cannot move, resize or focus itself the way a Tauri window can.
 * The UI is written against a promise-returning API, so every call here resolves
 * instead of throwing: window chrome (pin, stick-to-edge, always-on-top) simply
 * has no observable effect. Sizes still round-trip through `innerSize` so the
 * layout code that measures itself keeps working.
 */

export class LogicalSize {
  constructor(public width: number, public height: number) {}
}

export class PhysicalSize {
  constructor(public width: number, public height: number) {}
}

export class PhysicalPosition {
  constructor(public x: number, public y: number) {}
}

export class LogicalPosition {
  constructor(public x: number, public y: number) {}
}

type UnlistenFn = () => void;

export interface WebWindow {
  label: string;
  scaleFactor(): Promise<number>;
  innerSize(): Promise<PhysicalSize>;
  outerSize(): Promise<PhysicalSize>;
  innerPosition(): Promise<PhysicalPosition>;
  outerPosition(): Promise<PhysicalPosition>;
  isVisible(): Promise<boolean>;
  isAlwaysOnTop(): Promise<boolean>;
  isFocused(): Promise<boolean>;
  theme(): Promise<string | null>;
  setSize(size: LogicalSize | PhysicalSize): Promise<void>;
  setPosition(position: LogicalPosition | PhysicalPosition): Promise<void>;
  setAlwaysOnTop(value: boolean): Promise<void>;
  setFocusable(value: boolean): Promise<void>;
  setIgnoreCursorEvents(value: boolean): Promise<void>;
  startDragging(): Promise<void>;
  setFocus(): Promise<void>;
  show(): Promise<void>;
  hide(): Promise<void>;
  close(): Promise<void>;
  listen(name: string, handler: (event: unknown) => void): Promise<UnlistenFn>;
  onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<UnlistenFn>;
  onResized(handler: (event: { payload: PhysicalSize }) => void): Promise<UnlistenFn>;
  onMoved(handler: (event: { payload: PhysicalPosition }) => void): Promise<UnlistenFn>;
}

const noop = async () => {};

/** Listeners registered through a window object, so they can be torn down. */
const windowListeners = new Set<() => void>();

function viewportSize(): PhysicalSize {
  return new PhysicalSize(window.innerWidth, window.innerHeight);
}

function onMediaChange(handler: (event: { payload: string }) => void): Promise<UnlistenFn> {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => handler({ payload: query.matches ? "dark" : "light" });
  query.addEventListener("change", listener);
  const off = () => {
    query.removeEventListener("change", listener);
    windowListeners.delete(off);
  };
  windowListeners.add(off);
  return Promise.resolve(off);
}

function windowSurface(): Record<string, unknown> {
  return {
    label: "main",
    scaleFactor: async () => window.devicePixelRatio || 1,
    innerSize: async () => viewportSize(),
    outerSize: async () => viewportSize(),
    innerPosition: async () => new PhysicalPosition(0, 0),
    outerPosition: async () => new PhysicalPosition(0, 0),
    isVisible: async () => !document.hidden,
    isAlwaysOnTop: async () => false,
    isFocused: async () => document.hasFocus(),
    theme: async () => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
    onThemeChanged: onMediaChange,
    setSize: noop,
    setPosition: noop,
    setAlwaysOnTop: noop,
    setFocusable: noop,
    setIgnoreCursorEvents: noop,
    startDragging: noop,
    setFocus: noop,
    show: noop,
    hide: noop,
    close: noop,
    listen: async () => () => {},
    onFocusChanged: (handler: (event: { payload: boolean }) => void) => {
      const listener = () => handler({ payload: document.hasFocus() });
      window.addEventListener("focus", listener);
      window.addEventListener("blur", listener);
      const off = () => {
        window.removeEventListener("focus", listener);
        window.removeEventListener("blur", listener);
        windowListeners.delete(off);
      };
      windowListeners.add(off);
      return Promise.resolve(off);
    },
    onResized: (handler: (event: { payload: PhysicalSize }) => void) => {
      const listener = () => handler({ payload: viewportSize() });
      window.addEventListener("resize", listener);
      const off = () => {
        window.removeEventListener("resize", listener);
        windowListeners.delete(off);
      };
      windowListeners.add(off);
      return Promise.resolve(off);
    },
    onMoved: async () => () => {},
  };
}

let cached: WebWindow | null = null;

/**
 * A window handle. Anything the shim does not model resolves to `undefined`
 * through a Proxy: the Tauri window API is large, and an unmodelled method
 * (like `onThemeChanged`) should have no effect rather than crash the UI.
 */
export function getCurrentWindow(): WebWindow {
  if (cached) return cached;
  const surface = windowSurface();
  cached = new Proxy(surface, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return async () => undefined;
    },
  }) as unknown as WebWindow;
  return cached;
}

/** No secondary monitor exists in a browser tab. */
export async function currentMonitor() {
  return null;
}

export async function availableMonitors() {
  return [];
}

export async function getAllWindows() {
  return [getCurrentWindow()];
}
