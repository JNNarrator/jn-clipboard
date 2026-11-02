/**
 * Collects per-platform updater entries into the `latest.json` the plugin polls.
 *
 * Each build job writes its own fragment (`updater-<platform>.json`) while the
 * bundle is still on the runner, which is the only place the two macOS
 * architectures are distinguishable: both produce a file literally named
 * `jn-clipboard.app.tar.gz`, so a flat upload loses one of them and the
 * remaining copy gets attributed to the wrong runner. That is exactly what
 * happened the first time this shipped, and the manifest advertised an arm64
 * build under `darwin-x86_64`.
 *
 * Usage: node scripts/make-update-manifest.mjs <version> <out-file> <tag> <fragment>...
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [version, outFile, tag, ...fragments] = process.argv.slice(2);
if (!version || !outFile || !tag || fragments.length === 0) {
  console.error(
    "usage: node scripts/make-update-manifest.mjs <version> <out-file> <tag> <fragment>...",
  );
  process.exit(1);
}

const base = `https://github.com/JNNarrator/jn-clipboard/releases/download/${tag}`;
const platforms = {};

for (const fragment of fragments) {
  if (!existsSync(fragment)) {
    console.error(`missing fragment ${fragment}`);
    process.exit(1);
  }
  const entry = JSON.parse(readFileSync(fragment, "utf8"));
  if (!entry.platform || !entry.name || !entry.signature) {
    console.error(`fragment ${fragment} is incomplete`);
    process.exit(1);
  }
  platforms[entry.platform] = {
    name: entry.name,
    url: `${base}/${entry.name}`,
    signature: entry.signature.trim(),
  };
}

if (Object.keys(platforms).length === 0) {
  console.error("no updater fragments found; refusing to write an empty manifest");
  process.exit(1);
}

const manifest = {
  version,
  notes: `jn-clipboard ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${outFile}`);
for (const [platform, entry] of Object.entries(platforms)) {
  console.log(`  ${platform}: ${entry.name}`);
}
