import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// `VITE_TARGET=web` builds the browser/PWA app from the same source tree: the
// aliases below swap the eight Tauri modules for their `src/web/shims`
// counterparts, so no component has to know which target it runs in. The
// existing runtime guard stays correct — `isTauriRuntime()` reads
// `__TAURI_INTERNALS__`, which the shim never installs.
const isWebTarget = process.env.VITE_TARGET === "web";

const shim = (name: string) => fileURLToPath(new URL(`./src/web/shims/${name}.ts`, import.meta.url));

const WEB_ALIASES: Record<string, string> = {
  "@tauri-apps/api/core": shim("core"),
  "@tauri-apps/api/event": shim("event"),
  "@tauri-apps/api/window": shim("window"),
  "@tauri-apps/api/app": shim("app"),
  "@tauri-apps/plugin-dialog": shim("dialog"),
  "@tauri-apps/plugin-opener": shim("opener"),
};

/**
 * First-run settings, read from the Rust source at build time. The web backend
 * seeds IndexedDB from the same list `seed_defaults` writes, so a fresh browser
 * profile starts with the same theme, limits and capture rules as a fresh
 * install rather than with an empty settings map. Parsed here (not imported)
 * because `src-tauri` is not part of the frontend module graph.
 */
const defaultSettingsPlugin = () => ({
  name: "tiez-default-settings",
  resolveId: (id: string) => (id === "virtual:tiez-defaults" ? "\0virtual:tiez-defaults" : null),
  load: (id: string) => {
    if (id !== "\0virtual:tiez-defaults") return null;
    const rust = readFileSync(
      fileURLToPath(new URL("./src-tauri/src/database.rs", import.meta.url)),
      "utf8",
    );
    const pairs: [string, string][] = [
      ...[...rust.matchAll(/INSERT OR IGNORE INTO settings \(key, value\) VALUES \('([^']+)', '([^']*)'\)/g)]
        .map((m): [string, string] => [m[1], m[2]]),
      // CHANGED_DEFAULTS: ("key", "new installs", "existing installs").
      ...[...rust.matchAll(/\("([a-z0-9_.]+)", "([^"]*)", "[^"]*"\),/g)]
        .map((m): [string, string] => [m[1], m[2]]),
    ];
    return `export default ${JSON.stringify(Object.fromEntries(pairs))};`;
  },
});

const pkgVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
).version as string;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), defaultSettingsPlugin()],

  resolve: {
    alias: isWebTarget ? WEB_ALIASES : {},
  },

  // `getVersion()` reads this instead of asking the native shell; `__WEB_TARGET__`
  // lets shared entry points register the service worker only in a web build.
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __WEB_TARGET__: JSON.stringify(isWebTarget),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // The desktop bundle is embedded in the Tauri binary; the PWA one is served
    // from a web root. Separate dirs so a web build never ships a stale desktop
    // bundle (or the other way round).
    outDir: isWebTarget ? "dist/pwa" : "dist/web",
    emptyOutDir: true,
    // Smaller production assets for embedding into the Tauri binary
    target: "es2021",
    minify: "esbuild",
    cssMinify: true,
    sourcemap: false,
    reportCompressedSize: false,
    // Keep one main chunk; Tauri loads from disk, not network
    assetsInlineLimit: 4096,
  },
  test: {
    include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/artifacts/**"],
    // `npm run test:coverage`. Report only, no thresholds yet: the point is to
    // see where the gaps are. Files no test imports count as 0% (vitest default).
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // Data tables, not logic: they would inflate the number by ~4,400 lines.
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/locales.ts", "src/features/emoji/lib/emojiNames.ts"],
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
}));
