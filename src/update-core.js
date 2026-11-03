'use strict';
/* Update logic independent of Electron (testable with plain Node). */
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { finished } = require('node:stream/promises');

/** "owner/repo" from the repository field of package.json. */
function repoFromPackage(pkg) {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const m = /github\.com[/:]([^/\s]+)\/([^/\s#]+?)(?:\.git)?(?:[#/].*)?$/.exec(url || '');
  return m ? `${m[1]}/${m[2]}` : null;
}

/** "sha256:<hex>" (digest field of GitHub assets) → hex, otherwise null. */
function parseDigest(digest) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(digest || '');
  return m ? m[1].toLowerCase() : null;
}

/** Latest stable release: { version, tag, url, assets }, or null if there is none. */
async function fetchLatestRelease({ fetch, repo, feedUrl, userAgent }) {
  const url = feedUrl || `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(userAgent ? { 'User-Agent': userAgent } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`);
  const json = await res.json();
  if (!json || json.draft || json.prerelease || !json.tag_name) return null;
  return {
    version: String(json.tag_name).replace(/^v/, ''),
    tag: json.tag_name,
    url: json.html_url,
    assets: (json.assets || [])
      .filter((a) => !a.state || a.state === 'uploaded')
      .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size, sha256: parseDigest(a.digest) })),
  };
}

/**
 * Asset to install on the current platform (names produced by electron-builder, see package.json):
 * macOS → *-mac-<arch>.dmg, Windows → *-win-setup.exe.
 */
function pickAsset(assets, { platform, arch, translated = false }) {
  if (platform === 'darwin') {
    const want = translated ? 'arm64' : arch; // x64 app under Rosetta → native build
    return assets.find((a) => a.name.endsWith(`-mac-${want}.dmg`))
      || assets.find((a) => a.name.endsWith(`-${want}.dmg`))
      || null;
  }
  if (platform === 'win32') {
    return assets.find((a) => /-win-setup\.exe$/i.test(a.name))
      || assets.find((a) => /setup.*\.exe$/i.test(a.name))
      || null;
  }
  return null;
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Downloads `url` to `dest` (through a .part file), checks the size and the sha256.
 * If `dest` already exists with the expected sha256, it is reused without downloading.
 */
async function download({ fetch, url, dest, expectedSha256, onProgress, headers }) {
  if (expectedSha256) {
    const cached = await sha256File(dest).catch(() => null);
    if (cached === expectedSha256) {
      onProgress?.(1, 1);
      return { path: dest, sha256: cached, cached: true };
    }
  }

  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const part = `${dest}.part`;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(part);
  let received = 0;

  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.length;
      if (!out.write(value)) await once(out, 'drain');
      onProgress?.(received, total);
    }
    out.end();
    await finished(out);
    if (total && received !== total) throw new Error(`Incomplete download (${received}/${total} bytes)`);
    const digest = hash.digest('hex');
    if (expectedSha256 && digest !== expectedSha256) throw new Error('Checksum mismatch: the downloaded file is corrupted');
    await fsp.rename(part, dest);
    return { path: dest, sha256: digest, cached: false };
  } catch (err) {
    out.destroy();
    await fsp.rm(part, { force: true });
    throw err;
  }
}

/** Working paths next to the installed .app bundle. */
function macPaths(target) {
  const dir = path.dirname(target);
  const base = path.basename(target);
  return { staged: path.join(dir, `.${base}.update`), backup: path.join(dir, `.${base}.old`) };
}

/**
 * Replaces the installed bundle with the staged copy (synchronous: called during will-quit).
 * The previous bundle is kept as .old (removed at the next launch) and restored on failure.
 */
function swapMacBundle(target, staged) {
  const { backup } = macPaths(target);
  fs.rmSync(backup, { recursive: true, force: true });
  fs.renameSync(target, backup);
  try {
    fs.renameSync(staged, target);
  } catch (err) {
    fs.renameSync(backup, target);
    throw err;
  }
}

module.exports = { repoFromPackage, parseDigest, fetchLatestRelease, pickAsset, sha256File, download, macPaths, swapMacBundle };
