#!/usr/bin/env node
// Local stand-in for GET /repos/:owner/:repo/releases/latest, for SKILLS_BOOK_UPDATE_FEED.
// Usage: node mock-feed.mjs [--version 9.9.9] [--mode available|none|error] [--port 8787]
//   available → release v<version> with the usual mac/win asset names (the default)
//   none      → 404, like a repository without any release
//   error     → HTTP 500
// Switch mode while running: curl http://127.0.0.1:<port>/mode/<mode>
import http from 'node:http';
import { parseArgs } from 'node:util';

const { values: opts } = parseArgs({
  options: {
    version: { type: 'string', default: '9.9.9' },
    mode: { type: 'string', default: 'available' },
    port: { type: 'string', default: '8787' },
  },
});

const MODES = new Set(['available', 'none', 'error']);
let mode = opts.mode;
const repo = 'https://github.com/pyxel-dev/skills-book';

const release = (version) => ({
  tag_name: `v${version}`,
  name: `Skills Book ${version}`,
  html_url: `${repo}/releases/tag/v${version}`,
  draft: false,
  prerelease: false,
  // Same names as electron-builder's artifactName in package.json; URLs are not downloadable.
  assets: ['mac-arm64.dmg', 'mac-x64.dmg', 'win-setup.exe'].map((suffix) => ({
    name: `skills-book-${version}-${suffix}`,
    browser_download_url: `http://127.0.0.1:${opts.port}/missing/${suffix}`,
    size: 1,
    state: 'uploaded',
    digest: `sha256:${'0'.repeat(64)}`,
  })),
});

const server = http.createServer((req, res) => {
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const switchTo = /^\/mode\/(\w+)$/.exec(req.url);
  if (switchTo && MODES.has(switchTo[1])) {
    mode = switchTo[1];
    console.log(`mode → ${mode}`);
    return json(200, { mode });
  }
  console.log(`${req.method} ${req.url} → ${mode}`);
  if (mode === 'none') return json(404, { message: 'Not Found' });
  if (mode === 'error') return json(500, { message: 'Mock server error' });
  return json(200, release(opts.version));
});

server.listen(Number(opts.port), '127.0.0.1', () => {
  console.log(`Mock release feed: http://127.0.0.1:${opts.port}/latest (v${opts.version}, mode ${mode})`);
  console.log(`Run the app with: SKILLS_BOOK_UPDATE_FEED=http://127.0.0.1:${opts.port}/latest npm start`);
});
