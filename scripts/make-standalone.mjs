// Builds dist-standalone/box-breath.html: one self-contained file (code, styles and icon inlined,
// classic script instead of a module, no service worker) that works when opened straight from disk.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(root, 'dist-standalone', '.tmp');
const out = join(root, 'dist-standalone', 'box-breath.html');
rmSync(join(root, 'dist-standalone'), { recursive: true, force: true });

await build({
  root,
  configFile: false,
  logLevel: 'warn',
  base: './',
  publicDir: false,
  build: {
    outDir: tmp,
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: 'app[extname]' } },
  },
});

let html = readFileSync(join(tmp, 'index.html'), 'utf8');
const js = readFileSync(join(tmp, 'app.js'), 'utf8');
const css = readFileSync(join(tmp, 'app.css'), 'utf8');
const icon = readFileSync(join(root, 'public', 'icons', 'icon-192.png')).toString('base64');

html = html
  .replace(/<script type="module"[^>]*><\/script>\s*/, '')
  .replace(/<link rel="stylesheet"[^>]*>\s*/, `<style>${css}</style>\n`)
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/png" href="data:image/png;base64,${icon}" />`)
  .replace(/<link rel="apple-touch-icon"[^>]*>/, `<link rel="apple-touch-icon" href="data:image/png;base64,${icon}" />`)
  .replace('</body>', () => `<script>${js.replaceAll('</script', '<\\/script')}</script>\n</body>`);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KiB)`);
