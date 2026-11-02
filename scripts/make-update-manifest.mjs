/**
 * Builds `latest.json`, the file the updater plugin polls.
 *
 * Tauri writes a `.sig` next to every bundle when `createUpdaterArtifacts` is
 * on. This collects them into the one manifest the endpoint serves, so the app
 * knows which download belongs to which platform and can verify its signature
 * before running it.
 *
 * Usage: node scripts/make-update-manifest.mjs <version> <out-file> <tag> <asset-dir>...
 *
 * The asset directory is where the workflow put the installers (flat, as
 * uploaded to the release). Asset names are matched rather than enumerated so
 * a rename in tauri.conf.json does not silently produce an empty manifest.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [version, outFile, tag, ...dirs] = process.argv.slice(2);
if (!version || !outFile || !tag || dirs.length === 0) {
  console.error(
    "usage: node scripts/make-update-manifest.mjs <version> <out-file> <tag> <asset-dir>...",
  );
  process.exit(1);
}

/** Every file under the given directories, flattened. */
function collect(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collect(full));
    } else {
      found.push(full);
    }
  }
  return found;
}

const files = dirs.filter((dir) => existsSync(dir)).flatMap(collect);
const base = `https://github.com/JNNarrator/jn-clipboard/releases/download/${tag}`;

/**
 * One platform entry. `runner` is what the updater asks for: the target
 * triple, not an OS name.
 */
function entry(platform, matcher) {
  const bundle = files.find((file) => matcher(file) && !file.endsWith(".sig"));
  if (!bundle) return null;
  const signature = files.find((file) => file === `${bundle}.sig`);
  if (!signature) {
    console.error(`no signature next to ${path.basename(bundle)}; was the build signed?`);
    process.exit(1);
  }
  return {
    platform,
    name: path.basename(bundle),
    url: `${base}/${path.basename(bundle)}`,
    signature: readFileSync(signature, "utf8").trim(),
  };
}

/**
 * Which build a path belongs to. The artifact directories carry the arch in
 * their names (jn-clipboard-macos-arm64, -macos-x64, -windows-x64), while the
 * tarball inside is just `jn-clipboard.app.tar.gz`, so the directory is the
 * only place the difference shows.
 */
const inArm = (f) => /arm64|aarch64/.test(f);
const inIntel = (f) => !inArm(f) && /(macos|darwin)[-_]?(x64|intel)|(x64|intel)[-_]?mac/i.test(f);
const inWindows = (f) => /windows/i.test(f);

const platforms = [
  // macOS updates ship as the .app tarball Tauri produces alongside the dmg,
  // because the updater replaces the bundle in place rather than mounting a
  // disk image.
  entry("darwin-aarch64", (f) => f.endsWith(".app.tar.gz") && inArm(f)),
  entry("darwin-x86_64", (f) => f.endsWith(".app.tar.gz") && inIntel(f)),
  entry("windows-x86_64", (f) => f.endsWith("-setup.exe") && inWindows(f)),
].filter(Boolean);

if (platforms.length === 0) {
  console.error("no updater bundles found; refusing to write an empty manifest");
  process.exit(1);
}

const manifest = {
  version,
  notes: `jn-clipboard ${version}`,
  pub_date: new Date().toISOString(),
  platforms: Object.fromEntries(platforms.map(({ platform, ...rest }) => [platform, rest])),
};

writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${outFile} with ${platforms.length} platform(s)`);
for (const { platform, name } of platforms) console.log(`  ${platform}: ${name}`);
