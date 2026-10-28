/**
 * Settings store for the web build. Same flat key/value map as the `settings`
 * table in `src-tauri/src/database.rs`, seeded from the same list so a fresh
 * browser profile matches a fresh desktop install.
 */
import defaults from "virtual:tiez-defaults";
import { db, type SettingInsert } from "./db";

/**
 * Seed a fresh profile, or top up an existing one with keys added since it was
 * created (the Rust side does the same with `INSERT OR IGNORE`).
 */
export async function ensureSeeded(): Promise<void> {
  const existing = await db.settings.count();
  const seed: SettingInsert[] = Object.entries(defaults).map(([key, value]) => ({ key, value }));
  if (existing === 0) {
    await db.settings.bulkPut(seed);
    return;
  }
  // Add only keys this build knows about, so an upgrade that introduces a new
  // setting does not leave it undefined for existing profiles.
  const known = new Set((await db.settings.toCollection().primaryKeys()) as string[]);
  const missing = seed.filter((row) => !known.has(row.key));
  if (missing.length) await db.settings.bulkPut(missing);
}

export async function getAllSettings(): Promise<Record<string, string>> {
  await ensureSeeded();
  const rows = await db.settings.toArray();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.settings.get(key);
  return row?.value ?? null;
}

export async function saveSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}

/** `reset_settings` drops everything and re-seeds, as the Rust command does. */
export async function resetSettings(): Promise<Record<string, string>> {
  await db.settings.clear();
  await db.settings.bulkPut(Object.entries(defaults).map(([key, value]) => ({ key, value })));
  return getAllSettings();
}
