/**
 * Build the standalone web app into `dist/`.
 * alphaTab runtime assets (worker, SMuFL fonts, Sonivox soundfont) are copied
 * from `vendor/` so the result is a plain static directory.
 */
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(appDir, 'dist');
const assets = path.join(dist, 'assets');
const vendor = path.join(appDir, 'vendor');

await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

const started = Date.now();
await build({
  entryPoints: [path.join(appDir, 'src/main.tsx')],
  outfile: path.join(dist, 'app.js'),
  bundle: true,
  minify: true,
  sourcemap: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'edge110', 'safari16'],
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.url': 'undefined' },
  legalComments: 'inline',
  charset: 'utf8',
  logLevel: 'info',
});

await cp(path.join(appDir, 'index.html'), path.join(dist, 'index.html'));
await cp(path.join(appDir, 'src/app.css'), path.join(dist, 'app.css'));
await cp(path.join(vendor, 'alphaTab.worker.js'), path.join(assets, 'alphaTab.worker.js'));
await cp(path.join(vendor, 'alphaTab.mjs'), path.join(assets, 'alphaTab.mjs'));
await cp(path.join(vendor, 'alphaTab.core.mjs'), path.join(assets, 'alphaTab.core.mjs'));
await cp(path.join(vendor, 'alphaTab-LICENSE'), path.join(assets, 'alphaTab-LICENSE'));
await cp(path.join(vendor, 'font'), path.join(assets, 'font'), { recursive: true });
await cp(path.join(vendor, 'soundfont'), path.join(assets, 'soundfont'), { recursive: true });

console.log(`TABFALL build ready in ${dist} (${Date.now() - started} ms)`);
