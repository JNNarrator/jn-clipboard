/**
 * Writes one platform's updater entry, on the runner that built it.
 *
 * The bundle name is not enough to identify a build: both macOS runners emit
 * `jn-clipboard.app.tar.gz`, and on Windows the installer differs per bundle
 * kind. This reads the actual artifacts in `bundle/` and pairs the one the
 * updater should fetch with its `.sig`.
 *
 * Usage: node scripts/make-updater-fragment.mjs <platform> <bundle-dir> <out-file>
 *   platform: darwin-aarch64 | darwin-x86_64 | windows-x86_64
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [platform, bundleDir, outFile] = process.argv.slice(2);
if (!platform || !bundleDir || !outFile) {
  console.error("usage: node scripts/make-updater-fragment.mjs <platform> <bundle-dir> <out-file>");
  process.exit(1);
}

function find(dir, suffix) {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = find(full, suffix);
      if (nested) return nested;
    } else if (entry.name.endsWith(suffix)) {
      return full;
    }
  }
  return null;
}

// macOS updates replace the .app in place, so the updater wants the tarball the
// bundler produces next to the dmg. Windows updates run the NSIS installer.
const bundle =
  platform === "windows-x86_64"
    ? find(path.join(bundleDir, "nsis"), "-setup.exe")
    : find(path.join(bundleDir, "macos"), ".app.tar.gz");

if (!bundle) {
  console.error(`no updater bundle under ${bundleDir} for ${platform}`);
  process.exit(1);
}

const signaturePath = `${bundle}.sig`;
if (!existsSync(signaturePath)) {
  console.error(`no signature for ${bundle}; was TAURI_SIGNING_PRIVATE_KEY set?`);
  process.exit(1);
}

const entry = {
  platform,
  name: path.basename(bundle),
  signature: readFileSync(signaturePath, "utf8").trim(),
};

writeFileSync(outFile, `${JSON.stringify(entry, null, 2)}\n`);
console.log(`[updater] ${platform} -> ${entry.name}`);
