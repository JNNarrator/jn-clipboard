import { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { toLocalFilePath, toTauriLocalImageSrc } from "../lib/localImageSrc";
import { isTauriRuntime } from "../lib/tauriRuntime";

// The list shows images at ~100px, but originals are often 4K screenshots that
// take tens of ms to decode on every mount. get_image_thumbnail returns a cached
// ≤320px copy (or the original when it is already small). Results are kept in
// memory so a card scrolled back into view gets its src synchronously.
const resolved = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const MAX_RESOLVED = 600;

const loadThumbnail = (path: string, key: string): Promise<string> => {
  let pending = inflight.get(key);
  if (!pending) {
    pending = invoke<string>("get_image_thumbnail", { path })
      .then((thumbPath) => convertFileSrc(thumbPath))
      .catch(() => convertFileSrc(path))
      .then((src) => {
        if (resolved.size >= MAX_RESOLVED) {
          const oldest = resolved.keys().next().value;
          if (oldest !== undefined) resolved.delete(oldest);
        }
        resolved.set(key, src);
        inflight.delete(key);
        return src;
      });
    inflight.set(key, pending);
  }
  return pending;
};

export const originalImageSrc = (content: string, isExternal?: boolean) =>
  content.startsWith("data:")
    ? content
    : toTauriLocalImageSrc(content) || (isExternal ? convertFileSrc(content) : content);

/**
 * Image src for a list card. Returns null only while a local file's thumbnail
 * is looked up for the first time; callers should keep the card's space reserved.
 */
export const useImageThumbnail = (
  content: string | null,
  isExternal?: boolean,
  /** Changes when the entry changes (e.g. its timestamp), so an updated image
   * isn't served from this session cache. */
  version?: number
): string | null => {
  const path = content && isTauriRuntime() ? toLocalFilePath(content) : null;
  const key = path ? `${path}|${version ?? 0}` : null;
  const fallback = content ? originalImageSrc(content, isExternal) : null;
  const [src, setSrc] = useState<string | null>(() => (key ? resolved.get(key) ?? null : fallback));

  useEffect(() => {
    if (!path || !key) {
      setSrc(fallback);
      return;
    }
    const cached = resolved.get(key);
    if (cached) {
      setSrc(cached);
      return;
    }
    let alive = true;
    setSrc(null);
    void loadThumbnail(path, key).then((next) => {
      if (alive) setSrc(next);
    });
    return () => {
      alive = false;
    };
  }, [path, key, fallback]);

  return src;
};
