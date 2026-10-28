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
