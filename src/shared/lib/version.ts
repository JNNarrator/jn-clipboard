/**
 * Version comparison for the update check.
 *
 * The desktop build asks Rust to do this (see `src-tauri/src/app/commands/
 * update_cmd.rs`), but the browser build has no Rust to ask, so the rule is
 * written twice. Both implementations must agree, which is why their tests
 * carry the same cases.
 */

export type Version = [number, number, number];

/**
 * Parses the numeric core of a version, ignoring a `v` prefix and any
 * prerelease or build suffix: "v1.2.3-beta.1" → [1, 2, 3].
 *
 * Only the ordered triple matters here: a prerelease of a newer version is
 * still newer than the release people are running, and GitHub only hands out
 * published releases.
 */
export function parseVersion(value: string): Version | null {
  const core = value.trim().replace(/^[vV]+/, "").split(/[-+]/)[0];
  const parts = core.split(".");
  if (parts.length > 3) return null;

  const numbers: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const raw = parts[index] ?? "0";
    if (!/^\d+$/.test(raw)) return null;
    numbers.push(Number(raw));
  }
  return [numbers[0], numbers[1], numbers[2]];
}

/** Negative when `a` is older, zero when equal, positive when `a` is newer. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Whether `latest` is worth telling the user about. Anything unparseable
 * compares as "not newer": a garbled tag must never look like an update.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const parsed = parseVersion(latest);
  if (!parsed || !parseVersion(current)) return false;
  return compareVersions(latest, current) > 0;
}
