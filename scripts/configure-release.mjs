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

const isCi = process.env.GITHUB_ACTIONS === "true" || process.env.CI === "true";

const requiredInCi = [
  "TIEZ_ANNOUNCEMENT_PING_URL"
];

for (const key of requiredInCi) {
  if (isCi && !process.env[key]?.trim()) {
    console.error(`[configure-release] Missing required env: ${key}`);
    process.exit(1);
  }
}

const configPath = resolve("src-tauri/tauri.conf.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

const releaseChannel = (process.env.TIEZ_RELEASE_CHANNEL || "stable").trim().toLowerCase();
if (!["stable", "beta"].includes(releaseChannel)) {
  console.error("[configure-release] TIEZ_RELEASE_CHANNEL must be stable or beta");
  process.exit(1);
}

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log("[configure-release] Updated Tauri release config");
console.log(`[configure-release] release channel: ${releaseChannel}`);
