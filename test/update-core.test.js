'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const core = require('../src/update-core');
const semver = require('../src/shared/semver');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skills-book-test-'));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Actual asset names of release v0.2.0
const ASSETS = [
  { name: 'skills-book-0.2.0-mac-arm64.dmg' },
  { name: 'skills-book-0.2.0-mac-x64.dmg' },
  { name: 'skills-book-0.2.0-win-setup.exe' },
];

test('semver: spec precedence and isNewer', () => {
  const seq = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
  for (let i = 0; i < seq.length - 1; i++) {
    assert.ok(semver.compare(semver.parse(seq[i]), semver.parse(seq[i + 1])) < 0, `${seq[i]} < ${seq[i + 1]}`);
  }
  assert.equal(semver.isNewer('v0.3.0', '0.2.0'), true);
  assert.equal(semver.isNewer('0.2.0', '0.2.0'), false);
  assert.equal(semver.isNewer('0.1.9', '0.2.0'), false);
  assert.equal(semver.isNewer('garbage', '0.2.0'), false);
});

test('repoFromPackage', () => {
  assert.equal(core.repoFromPackage({ repository: { url: 'git+https://github.com/pyxel-dev/skills-book.git' } }), 'pyxel-dev/skills-book');
  assert.equal(core.repoFromPackage({ repository: 'git@github.com:owner/repo.git' }), 'owner/repo');
  assert.equal(core.repoFromPackage({ repository: 'https://github.com/owner/repo' }), 'owner/repo');
  assert.equal(core.repoFromPackage({}), null);
});

test('parseDigest', () => {
  const hex = 'a'.repeat(64);
  assert.equal(core.parseDigest(`sha256:${hex}`), hex);
  assert.equal(core.parseDigest(`sha256:${hex.toUpperCase()}`), hex);
  assert.equal(core.parseDigest('md5:abc'), null);
  assert.equal(core.parseDigest(undefined), null);
});

test('pickAsset: per platform and arch', () => {
  const pick = (platform, arch, translated) => core.pickAsset(ASSETS, { platform, arch, translated })?.name ?? null;
  assert.equal(pick('darwin', 'arm64'), 'skills-book-0.2.0-mac-arm64.dmg');
  assert.equal(pick('darwin', 'x64'), 'skills-book-0.2.0-mac-x64.dmg');
  assert.equal(pick('darwin', 'x64', true), 'skills-book-0.2.0-mac-arm64.dmg');
  assert.equal(pick('win32', 'x64'), 'skills-book-0.2.0-win-setup.exe');
  assert.equal(pick('win32', 'arm64'), 'skills-book-0.2.0-win-setup.exe');
  assert.equal(pick('linux', 'x64'), null);
});

test('fetchLatestRelease: mapping, 404 and errors', async () => {
  const hex = 'b'.repeat(64);
  const body = {
    tag_name: 'v0.3.0',
    html_url: 'https://github.com/o/r/releases/tag/v0.3.0',
    assets: [
      { name: 'a.dmg', browser_download_url: 'https://x/a.dmg', size: 10, digest: `sha256:${hex}`, state: 'uploaded' },
      { name: 'b.dmg', browser_download_url: 'https://x/b.dmg', size: 10, state: 'new' },
    ],
  };
  const fake = (status, json) => async () => ({ status, ok: status < 400, json: async () => json });

  const release = await core.fetchLatestRelease({ fetch: fake(200, body), repo: 'o/r' });
  assert.deepEqual(release, {
    version: '0.3.0',
    tag: 'v0.3.0',
    url: 'https://github.com/o/r/releases/tag/v0.3.0',
    assets: [{ name: 'a.dmg', url: 'https://x/a.dmg', size: 10, sha256: hex }],
  });
  assert.equal(await core.fetchLatestRelease({ fetch: fake(404), repo: 'o/r' }), null);
  assert.equal(await core.fetchLatestRelease({ fetch: fake(200, { ...body, prerelease: true }), repo: 'o/r' }), null);
  await assert.rejects(core.fetchLatestRelease({ fetch: fake(500), repo: 'o/r' }), /HTTP 500/);
});

test('download: redirect, progress, sha256, cache', async (t) => {
  const payload = crypto.randomBytes(256 * 1024);
  let hits = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/file' }); return res.end(); }
    hits++;
    res.writeHead(200, { 'Content-Length': payload.length });
    res.end(payload);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/redirect`;
  const dir = tmp();
  const dest = path.join(dir, 'app.dmg');

  const progress = [];
  const res = await core.download({ fetch, url, dest, expectedSha256: sha(payload), onProgress: (r, total) => progress.push([r, total]) });
  assert.equal(res.cached, false);
  assert.deepEqual(fs.readFileSync(dest), payload);
  assert.deepEqual(progress.at(-1), [payload.length, payload.length]);
  assert.equal(fs.existsSync(`${dest}.part`), false);

  const again = await core.download({ fetch, url, dest, expectedSha256: sha(payload) });
  assert.equal(again.cached, true);
  assert.equal(hits, 1);

  const bad = path.join(dir, 'bad.dmg');
  await assert.rejects(core.download({ fetch, url, dest: bad, expectedSha256: 'c'.repeat(64) }), /Checksum mismatch/);
  assert.equal(fs.existsSync(bad), false);
  assert.equal(fs.existsSync(`${bad}.part`), false);
});

test('swapMacBundle: swap, and restore on failure', () => {
  const dir = tmp();
  const target = path.join(dir, 'Skills Book.app');
  const { staged, backup } = core.macPaths(target);
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'v'), 'old');
  fs.mkdirSync(staged); fs.writeFileSync(path.join(staged, 'v'), 'new');

  core.swapMacBundle(target, staged);
  assert.equal(fs.readFileSync(path.join(target, 'v'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(backup, 'v'), 'utf8'), 'old');
  assert.equal(fs.existsSync(staged), false);

  // Missing staged copy: the installed app must stay in place.
  assert.throws(() => core.swapMacBundle(target, staged));
  assert.equal(fs.readFileSync(path.join(target, 'v'), 'utf8'), 'new');
});
