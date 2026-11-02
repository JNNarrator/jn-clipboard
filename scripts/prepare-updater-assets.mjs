/**
 * Gives the two macOS updater tarballs distinct names before the manifest is
 * written.
 *
 * Both macOS runners emit `jn-clipboard.app.tar.gz`, so once the artifacts are
 * flattened into one directory the second one is either lost or silently
 * renamed by the shell. The architecture only survives in the artifact
 * directory name (`jn-clipboard-macos-arm64`, `-macos-x64`), so the pairing is
 * done from there, and each fragment is rewritten to name the file it owns.
 *
 * Usage: node scripts/prepare-updater-assets.mjs <dist-dir> <assets-dir>
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [distDir, assetsDir] = process.argv.slice(2);
if (!distDir || !assetsDir) {
  console.error("usage: node scripts/prepare-updater-assets.mjs <dist-dir> <assets-dir>");
  process.exit(1);
}

/** Artifact directory name pattern -> (update platform, release file name). */
const TARGETS = [
  { match: /macos[-_]?arm64|macos[-_]?aarch64/i, platform: "darwin-aarch64", name: "jn-clipboard-aarch64.app.tar.gz" },
  { match: /macos[-_]?x64|macos[-_]?intel/i, platform: "darwin-x86_64", name: "jn-clipboard-x86_64.app.tar.gz" },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(distDir);

for (const target of TARGETS) {
  const tarball = files.find(
    (file) => target.match.test(file) && file.endsWith(".app.tar.gz"),
  );
  if (!tarball) {
    console.error(`no .app.tar.gz under an artifact matching ${target.match}`);
    process.exit(1);
  }
  const signature = `${tarball}.sig`;
  if (!existsSync(signature)) {
    console.error(`no signature for ${tarball}`);
    process.exit(1);
  }
  copyFileSync(tarball, path.join(assetsDir, target.name));
  copyFileSync(signature, path.join(assetsDir, `${target.name}.sig`));

  // Point the fragment at the renamed file so the manifest matches what is
  // actually attached to the release.
  const fragment = path.join(assetsDir, `updater-${target.platform}.json`);
  if (!existsSync(fragment)) {
    console.error(`missing ${fragment}`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(fragment, "utf8"));
  data.name = target.name;
  writeFileSync(fragment, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`[updater] ${target.platform} -> ${target.name}`);
}
