// Assembles the two store packages from one codebase: dist/chrome and dist/firefox, each a copy of
// src/ and icons/ plus its own manifest from manifests/<browser>.json, and packs each directory
// into dist/pfg-companion-<browser>-<version>.zip (Windows bsdtar creates zip archives via -a).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const browsers = ['chrome', 'firefox'];

/** @param {string} from @param {string} to */
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else if (entry.isFile()) fs.copyFileSync(source, target);
  }
}

const missing = [];
for (const dir of ['src', 'icons', ...browsers.map((b) => path.join('manifests', `${b}.json`))]) {
  if (!fs.existsSync(path.join(root, dir))) missing.push(dir);
}
if (missing.length) {
  console.error(`Not built, missing: ${missing.join(', ')}.`);
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'chrome.json'), 'utf8')).version;
for (const browser of browsers) {
  const target = path.join(dist, browser);
  fs.rmSync(target, { recursive: true, force: true });
  copyTree(path.join(root, 'src'), path.join(target, 'src'));
  copyTree(path.join(root, 'icons'), path.join(target, 'icons'));
  fs.copyFileSync(path.join(root, 'manifests', `${browser}.json`), path.join(target, 'manifest.json'));
  const zip = path.join(dist, `pfg-companion-${browser}-${version}.zip`);
  fs.rmSync(zip, { force: true });
  // Relative paths and cwd: bsdtar reads an absolute Windows path such as D:\... as a host name.
  const packed = spawnSync('tar', ['-a', '-c', '-f', path.basename(zip), '-C', browser, '.'], { cwd: dist, stdio: 'inherit' });
  if (packed.status !== 0) {
    console.error(`Failed to pack ${zip}.`);
    process.exit(1);
  }
}
console.log(`dist/ ready, version ${version}.`);
