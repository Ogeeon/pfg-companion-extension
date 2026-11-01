// Syntax-checks every source file the extension ships (node --check), the way the userscript
// repo checks its single file. Exits non-zero on the first file that fails to parse.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');

/** @param {string} dir @param {string[]} [acc] @returns {string[]} */
function jsFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

const files = jsFiles(src);
if (!files.length) {
  console.log('No source files to check yet.');
  process.exit(0);
}

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Syntax check failed: ${path.relative(root, file)}`);
    failed = true;
    break;
  }
}
if (!failed) console.log(`Syntax OK (${files.length} file${files.length === 1 ? '' : 's'}).`);
process.exit(failed ? 1 : 0);
