import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const brand = join(root, 'web/reptest/public/brand');
const native = join(root, 'web/src-tauri/icons');
// Keep the supplied originals intact. Only tighten the display canvas and title.
const source = readFileSync(join(brand, 'repo-relay-icon-transparent.svg'), 'utf8')
  .replace('viewBox="0 0 1248 1248"', 'viewBox="166 166 916 916"')
  .replace('Repo Relay —', 'Repro Relay —')
  .replace(/[ \t]+$/gm, '');
const temporary = mkdtempSync(join(tmpdir(), 'relay-brand-'));
try {
  const input = join(temporary, 'brand-source.svg');
  writeFileSync(input, source);
  execFileSync(join(root, 'web/node_modules/.bin/tauri'), ['icon', input, '--output', temporary], { stdio: 'inherit' });
  for (const name of ['repro-relay-mark.svg', 'favicon.svg']) {
    writeFileSync(join(brand, name), source);
  }
  writeFileSync(join(native, 'brand-source.svg'), source);
  for (const name of ['icon.png', 'icon.icns', 'icon.ico']) {
    copyFileSync(join(temporary, name), join(native, name));
  }
  // Existing theme-aware consumers both use the new full-color transparent icon.
  for (const mode of ['black', 'white']) {
    copyFileSync(join(temporary, '128x128@2x.png'), join(brand, `repro-relay-mark-${mode}.png`));
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
