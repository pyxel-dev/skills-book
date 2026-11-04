#!/usr/bin/env node
// Captures the Skills Book window with demo data (see demo-home.mjs).
// Usage: node capture.mjs [--out <dir>] [--theme light|dark|both] [--open <item name>] [--no-side] [--lang en|fr]
// Writes <out>/screenshot.png (light) and/or <out>/screenshot-dark.png (2x, 1280×800 window).
// Needs playwright-core in the repo (npm i --no-save playwright-core) and, on Linux, a display (xvfb-run).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createDemo } from './demo-home.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(path.join(repo, 'package.json'));

const { values: opts } = parseArgs({
  options: {
    out: { type: 'string', default: path.join(repo, 'docs') },
    theme: { type: 'string', default: 'both' },
    open: { type: 'string', default: 'deploy' },
    'no-side': { type: 'boolean', default: false },
    lang: { type: 'string', default: 'en' },
  },
});

let electron;
try {
  ({ _electron: electron } = require('playwright-core'));
} catch {
  console.error('playwright-core is missing: run `npm i --no-save playwright-core` in the repo first.');
  process.exit(1);
}
const electronPath = require('electron'); // the npm package exports the binary path

async function capture(theme, file) {
  const demo = createDemo();
  const dark = theme === 'dark';
  const app = await electron.launch({
    executablePath: electronPath,
    args: [repo, '--force-device-scale-factor=2', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...(dark ? ['--force-dark-mode'] : [])],
    env: { ...process.env, SKILLS_BOOK_HOME: demo.home, SKILLS_BOOK_USER_DATA: demo.userData },
    colorScheme: dark ? 'dark' : 'light',
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800));
    await page.waitForSelector('.item-main', { timeout: 15000 });
    if (opts.lang !== 'en') {
      await page.click('#btn-settings');
      await page.selectOption('#lang', opts.lang);
      await page.click('#settings-close');
    }
    // Overlay scrollbars are hidden at rest on macOS; Linux/Windows draw classic ones.
    await page.addStyleTag({ content: '::-webkit-scrollbar{width:0;height:0}.CodeMirror-vscrollbar,.CodeMirror-hscrollbar,.CodeMirror-scrollbar-filler{display:none!important}' });
    if (opts.open) {
      await page.click(`.item-main:has(.item-name:text-is("${opts.open}"))`);
      if (!opts['no-side']) await page.click('.tb-side-by-side');
    }
    await page.mouse.move(900, 700);
    await page.waitForTimeout(800);
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    writeFileSync(file, Buffer.from(png, 'base64'));
    if (errors.length) console.warn(`${theme}: page errors:`, errors);
    console.log(`${theme}: ${path.relative(process.cwd(), file)}`);
  } finally {
    await app.close();
  }
}

mkdirSync(opts.out, { recursive: true });
const themes = opts.theme === 'both' ? ['light', 'dark'] : [opts.theme];
for (const theme of themes) {
  await capture(theme, path.join(opts.out, theme === 'dark' ? 'screenshot-dark.png' : 'screenshot.png'));
}
