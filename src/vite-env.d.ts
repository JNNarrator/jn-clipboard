/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EDITION?: "local" | "cloud";
  /**
   * Base URL of the JNClub deployment the web build syncs with, e.g.
   * `https://jiangnan.88933.vip/jnclub`. Defaults to `<origin>/jnclub`.
   */
  readonly VITE_JNCLUB_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
