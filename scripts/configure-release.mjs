import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const applyVersion = spawnSync(
  process.execPath,
  [resolve("scripts/apply-app-version.mjs")],
  { stdio: "inherit", env: process.env },
);
if (applyVersion.status !== 0) {
  process.exit(applyVersion.status ?? 1);
}

const releaseChannel = (process.env.TIEZ_RELEASE_CHANNEL || "stable").trim().toLowerCase();
if (!["stable", "beta"].includes(releaseChannel)) {
  console.error("[configure-release] TIEZ_RELEASE_CHANNEL must be stable or beta");
  process.exit(1);
}

console.log(`[configure-release] release channel: ${releaseChannel}`);

/**
 * Point the macOS bundle at the signing identity this build should use.
 *
 * Ad-hoc (`-`) stays the fallback: it is what keeps a local build from being
 * rejected as "damaged". But ad-hoc signatures are identified by their code
 * hash, so every build looks like a different program to TCC, and the user has
 * to re-grant Accessibility after every update — and the grant for the *old*
 * build is left behind as a stale switch that does nothing. Signing with a real
 * certificate gives the app a stable identity, so one grant survives updates.
 *
 * `build-release.mjs` snapshots tauri.conf.json and restores it afterwards, so
 * this edit never reaches the working tree.
 */
const identity = (process.env.APPLE_SIGNING_IDENTITY || "").trim() || "-";
const tauriConfigPath = resolve("src-tauri/tauri.conf.json");
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
tauriConfig.bundle = tauriConfig.bundle || {};
tauriConfig.bundle.macOS = tauriConfig.bundle.macOS || {};
tauriConfig.bundle.macOS.signingIdentity = identity;
writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);
console.log(`[configure-release] macOS signing identity: ${identity}`);
