/**
 * Where the web build finds its login token.
 *
 * The PWA is served from the same origin as JNClub, so the site's own login
 * flow already leaves `jn-token` in localStorage. Keeping to that key (rather
 * than inventing one) means a user who signed in to JNClub is signed in here
 * too, and no extra login step exists to get wrong.
 */
export const TOKEN_STORAGE_KEY = "jn-token";

export function readToken(): string | null {
  try {
    const value = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    return value && value.trim() ? value.trim() : null;
  } catch {
    // Private-mode Safari and blocked third-party storage both throw here.
    return null;
  }
}

export function writeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    /* nothing useful to do: the session just stays unauthenticated */
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* see writeToken */
  }
}

/**
 * The SSO client redirects back with `?token=`. Consume it once, persist it, and
 * scrub the query string so the token does not end up in history, a shared
 * link, or a `Referer` header.
 */
export function adoptTokenFromUrl(): boolean {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  if (!token) return false;
  writeToken(token);
  url.searchParams.delete("token");
  window.history.replaceState(null, "", url.toString());
  return true;
}
