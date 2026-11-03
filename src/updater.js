'use strict';
/*
 * Updates from GitHub releases.
 * - Checked at launch (silently) and from the menu (with feedback to the user).
 * - macOS: the .dmg is mounted, the app copied next to the installed bundle, then swapped in on quit.
 *   (Squirrel.Mac / electron-updater require a Developer ID signature, which the builds don't have.)
 * - Windows: the NSIS installer runs silently on quit and relaunches the app.
 */
const { app, dialog, net, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const core = require('./update-core');
const { isNewer } = require('./shared/semver');
const pkg = require('../package.json');

const run = promisify(execFile);
const LAUNCH_DELAY_MS = 3000;

function createUpdater({ getWindow, tr, send }) {
  const repo = core.repoFromPackage(pkg);
  // Test feed (JSON in the GitHub API format), only outside the packaged app.
  const feedUrl = !app.isPackaged ? process.env.SKILLS_BOOK_UPDATE_FEED : undefined;
  const userAgent = `Skills-Book/${app.getVersion()} (+https://github.com/${repo})`;

  let busy = false;
  /** Install ready, applied on quit: { kind: 'mac', target, staged, version } | { kind: 'win', installer, version } */
  let pending = null;

  const win = () => getWindow();
  const status = (s) => send(s);
  const message = (opts) => dialog.showMessageBox(win() ?? undefined, { type: 'info', noLink: true, ...opts });
  const errorText = (err) => String(err?.message || err);

  function setProgress(value) {
    const w = win();
    if (w && !w.isDestroyed()) w.setProgressBar(value);
  }

  /* ---------- Check ---------- */

  async function check({ interactive = false } = {}) {
    if (busy || pending) {
      if (interactive) await message({ message: tr('update.busy'), buttons: [tr('update.ok')] });
      return;
    }
    if (!repo && !feedUrl) return;
    busy = true;
    try {
      const current = app.getVersion();
      const release = await core.fetchLatestRelease({ fetch: net.fetch, repo, feedUrl, userAgent });

      if (!release || !isNewer(release.version, current)) {
        if (interactive) {
          await message({
            message: tr('update.upToDate'),
            detail: tr('update.upToDateDetail', { current }),
            buttons: [tr('update.ok')],
          });
        }
        return;
      }

      const asset = core.pickAsset(release.assets, {
        platform: process.platform,
        arch: process.arch,
        translated: app.runningUnderARM64Translation,
      });
      const canInstall = app.isPackaged && Boolean(asset);
      const detailKey = canInstall ? 'update.availableDetail' : app.isPackaged ? 'update.noAssetDetail' : 'update.devDetail';
      const buttons = canInstall
        ? [tr('update.now'), tr('update.later'), tr('update.notes')]
        : [tr('update.notes'), tr('update.later')];

      const { response } = await message({
        message: tr('update.available', { version: release.version }),
        detail: tr(detailKey, { current }),
        buttons,
        defaultId: 0,
        cancelId: 1,
      });
      const choice = buttons[response];
      if (choice === tr('update.notes')) await shell.openExternal(release.url);
      if (choice === tr('update.now')) await install(release, asset);
    } catch (err) {
      setProgress(-1);
      if (interactive) {
        await message({ type: 'warning', message: tr('update.checkFailed'), detail: errorText(err), buttons: [tr('update.ok')] });
      } else {
        console.warn('[update]', errorText(err));
      }
    } finally {
      busy = false;
    }
  }

  /* ---------- Download and preparation ---------- */

  async function install(release, asset) {
    const { version } = release;
    try {
      const dir = path.join(app.getPath('temp'), 'skills-book-update');
      await fsp.mkdir(dir, { recursive: true });
      const file = path.join(dir, path.basename(asset.name));

      let last = -1;
      status({ state: 'downloading', version, percent: 0 });
      await core.download({
        fetch: net.fetch,
        url: asset.url,
        dest: file,
        expectedSha256: asset.sha256,
        headers: { 'User-Agent': userAgent },
        onProgress(received, total) {
          if (!total) return;
          const percent = Math.floor((received / total) * 100);
          if (percent === last) return;
          last = percent;
          setProgress(received / total);
          status({ state: 'downloading', version, percent });
        },
      });

      status({ state: 'installing', version });
      setProgress(2); // indeterminate
      pending = process.platform === 'darwin' ? await prepareMac(file, version) : { kind: 'win', installer: file, version };
      setProgress(-1);

      if (!pending) {
        status({ state: 'idle' });
        return;
      }
      // Register the relaunch now (on Windows the installer relaunches the app);
      // if the quit is cancelled, the update and the relaunch happen on the next quit.
      if (pending.kind === 'mac') app.relaunch();
      app.quit();
    } catch (err) {
      setProgress(-1);
      status({ state: 'error', message: errorText(err) });
    }
  }

  /** Copies the app from the .dmg next to the installed bundle; null if that location is not writable. */
  async function prepareMac(dmg, version) {
    const target = path.resolve(process.execPath, '..', '..', '..');
    const parent = path.dirname(target);
    const writable = await fsp.access(parent, fs.constants.W_OK).then(() => true, () => false);
    const movable = target.endsWith('.app') && !target.includes('/AppTranslocation/') && !target.startsWith('/Volumes/');

    if (!writable || !movable) {
      await shell.openPath(dmg);
      await message({
        message: tr('update.manual'),
        detail: tr('update.manualDetail', { path: parent }),
        buttons: [tr('update.ok')],
      });
      return null;
    }

    const mount = await fsp.mkdtemp(path.join(app.getPath('temp'), 'skills-book-mnt-'));
    await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noverify', '-noautoopen', '-mountpoint', mount, dmg]);
    try {
      const bundle = (await fsp.readdir(mount)).find((name) => name.endsWith('.app'));
      if (!bundle) throw new Error('No application found in the disk image');
      const { staged } = core.macPaths(target);
      await fsp.rm(staged, { recursive: true, force: true });
      await run('ditto', [path.join(mount, bundle), staged]);
      return { kind: 'mac', target, staged, version };
    } finally {
      await run('hdiutil', ['detach', mount, '-quiet'])
        .catch(() => run('hdiutil', ['detach', mount, '-force', '-quiet']))
        .catch(() => {});
      await fsp.rmdir(mount).catch(() => {});
    }
  }

  /* ---------- Apply on quit ---------- */

  function apply() {
    const job = pending;
    pending = null;
    if (!job) return;
    try {
      if (job.kind === 'mac') {
        core.swapMacBundle(job.target, job.staged);
      } else if (job.kind === 'win') {
        // --updated: silent update in the existing install folder; --force-run: relaunch after install.
        spawn(job.installer, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
      }
    } catch (err) {
      console.error('[update] install failed:', errorText(err));
    }
  }

  app.on('will-quit', apply);

  /** Cleanup at launch: previous bundle (.old) and unused staged copy (.update). */
  async function cleanup() {
    if (!app.isPackaged || process.platform !== 'darwin') return;
    const { staged, backup } = core.macPaths(path.resolve(process.execPath, '..', '..', '..'));
    await Promise.all([staged, backup].map((p) => fsp.rm(p, { recursive: true, force: true }).catch(() => {})));
  }

  return {
    check,
    cleanup,
    hasPending: () => Boolean(pending),
    /** The quit was cancelled (unsaved changes): the update waits for the next quit. */
    quitCancelled: () => { if (pending) status({ state: 'deferred', version: pending.version }); },
    /** Automatic check at launch: packaged app, or test feed in development. */
    scheduleLaunchCheck() {
      if (!app.isPackaged && !feedUrl) return;
      setTimeout(() => check({ interactive: false }), LAUNCH_DELAY_MS);
    },
  };
}

module.exports = { createUpdater };
