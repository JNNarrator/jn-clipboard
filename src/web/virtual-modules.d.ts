/**
 * Modules that only exist once a build has run. Declared here so `tsc` (which
 * does not resolve vite plugins) type-checks without a generated file.
 */

/** First-run settings parsed out of `src-tauri/src/database.rs` at build time. */
declare module "virtual:tiez-defaults" {
  const defaults: Record<string, string>;
  export default defaults;
}

/** `version` from package.json, injected by vite's `define`. */
declare const __APP_VERSION__: string;

/** True when building with `VITE_TARGET=web`; injected by vite's `define`. */
declare const __WEB_TARGET__: boolean;
