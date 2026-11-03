'use strict';
/*
 * Mise à jour depuis les releases GitHub.
 * - Vérification au lancement (silencieuse) et via le menu (avec retour à l'utilisateur).
 * - macOS : le .dmg est monté, l'app copiée à côté du bundle installé, puis échangée à la fermeture.
 *   (Squirrel.Mac / electron-updater exigent une signature Developer ID, que les builds n'ont pas.)
 * - Windows : l'installeur NSIS est lancé en silencieux à la fermeture et relance l'app.
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
  // Flux de test (JSON au format de l'API GitHub), uniquement hors app packagée.
  const feedUrl = !app.isPackaged ? process.env.SKILLS_BOOK_UPDATE_FEED : undefined;
  const userAgent = `Skills-Book/${app.getVersion()} (+https://github.com/${repo})`;

  let busy = false;
  /** Installation prête, appliquée à la fermeture : { kind: 'mac', target, staged, version } | { kind: 'win', installer, version } */
  let pending = null;

  const win = () => getWindow();
  const status = (s) => send(s);
  const message = (opts) => dialog.showMessageBox(win() ?? undefined, { type: 'info', noLink: true, ...opts });
  const errorText = (err) => String(err?.message || err);

  function setProgress(value) {
    const w = win();
    if (w && !w.isDestroyed()) w.setProgressBar(value);
  }

  /* ---------- Vérification ---------- */

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

  /* ---------- Téléchargement et préparation ---------- */

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
      setProgress(2); // indéterminé
      pending = process.platform === 'darwin' ? await prepareMac(file, version) : { kind: 'win', installer: file, version };
      setProgress(-1);

      if (!pending) {
        status({ state: 'idle' });
        return;
      }
      // Relance enregistrée tout de suite (Windows : c'est l'installeur qui relance) ;
      // si la fermeture est annulée, l'update et la relance auront lieu à la prochaine fermeture.
      if (pending.kind === 'mac') app.relaunch();
      app.quit();
    } catch (err) {
      setProgress(-1);
      status({ state: 'error', message: errorText(err) });
    }
  }

  /** Copie l'app du .dmg à côté du bundle installé ; null si l'emplacement n'est pas modifiable. */
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

  /* ---------- Application à la fermeture ---------- */

  function apply() {
    const job = pending;
    pending = null;
    if (!job) return;
    try {
      if (job.kind === 'mac') {
        core.swapMacBundle(job.target, job.staged);
      } else if (job.kind === 'win') {
        // --updated : mise à jour silencieuse dans le dossier existant ; --force-run : relance après installation.
        spawn(job.installer, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
      }
    } catch (err) {
      console.error('[update] install failed:', errorText(err));
    }
  }

  app.on('will-quit', apply);

  /** Nettoyage au lancement : ancien bundle (.old) et copie préparée non utilisée (.update). */
  async function cleanup() {
    if (!app.isPackaged || process.platform !== 'darwin') return;
    const { staged, backup } = core.macPaths(path.resolve(process.execPath, '..', '..', '..'));
    await Promise.all([staged, backup].map((p) => fsp.rm(p, { recursive: true, force: true }).catch(() => {})));
  }

  return {
    check,
    cleanup,
    hasPending: () => Boolean(pending),
    /** La fermeture a été annulée (modifications non enregistrées) : l'update attendra la prochaine. */
    quitCancelled: () => { if (pending) status({ state: 'deferred', version: pending.version }); },
    /** Vérification automatique au lancement : app packagée, ou flux de test en dev. */
    scheduleLaunchCheck() {
      if (!app.isPackaged && !feedUrl) return;
      setTimeout(() => check({ interactive: false }), LAUNCH_DELAY_MS);
    },
  };
}

module.exports = { createUpdater };
