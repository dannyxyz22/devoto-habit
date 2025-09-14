#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const configPath = path.join(root, 'src', 'config', 'appMeta.ts');

const readText = (p) => fs.readFileSync(p, 'utf8');

// Naive extract of APP_NAME and APP_SHORT_NAME from appMeta.ts
const metaSrc = readText(configPath);
const getVal = (name) => {
  const m = metaSrc.match(new RegExp(`export const ${name} = ['\"]([^'\"]+)['\"]`));
  return m ? m[1] : null;
};
const APP_NAME = getVal('APP_NAME');
const APP_SHORT_NAME = getVal('APP_SHORT_NAME') || APP_NAME;
if (!APP_NAME) {
  console.error('APP_NAME not found in appMeta.ts');
  process.exit(1);
}

// 1. manifest.json
const manifestFile = path.join(root, 'public', 'manifest.json');
try {
  const manifest = JSON.parse(readText(manifestFile));
  manifest.name = APP_NAME;
  manifest.short_name = APP_SHORT_NAME;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log('Updated manifest.json');
} catch (e) { console.warn('Skip manifest.json:', e.message); }

// 2. capacitor.config.ts (replace appName value)
const capFile = path.join(root, 'capacitor.config.ts');
try {
  let cap = readText(capFile);
  cap = cap.replace(/appName:\s*['\"][^'\"]+['\"]/g, `appName: '${APP_NAME}'`);
  fs.writeFileSync(capFile, cap);
  console.log('Updated capacitor.config.ts');
} catch (e) { console.warn('Skip capacitor.config.ts:', e.message); }

// 3. package.json (optional display; do NOT change npm package name automatically)
const pkgFile = path.join(root, 'package.json');
try {
  const pkg = JSON.parse(readText(pkgFile));
  if (pkg.displayName !== APP_NAME) {
    pkg.displayName = APP_NAME;
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
    console.log('Set package.json displayName');
  }
} catch (e) { console.warn('Skip package.json displayName:', e.message); }

console.log('App name sync complete.');
