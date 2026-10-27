'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { scanSkills, defaultRoots, isDir } = require('./scanner');
const I18n = require('./shared/i18n');

const isMac = process.platform === 'darwin';
const home = app.getPath('home');

let win = null;
let dirty = false;
const CONFIG_VERSION = 2;
let config = { version: CONFIG_VERSION, lang: I18n.DEFAULT, roots: [] };
const tr = (key, params) => I18n.t(config.lang, key, params);
/** id (chemin réel) -> { file, shown, eol } — seuls ces fichiers sont lisibles/modifiables via IPC. */
const registry = new Map();

/* ---------- Config ---------- */

const configFile = () => path.join(app.getPath('userData'), 'config.json');
/** Config de l'ancien nom de l'app (« Skills Manager »), reprise au premier lancement. */
const legacyConfigFile = () => path.join(app.getPath('appData'), 'Skills Manager', 'config.json');

const readJsonFile = async (file) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
};

async function loadConfig() {
  let raw = await readJsonFile(configFile());
  const migrated = !raw && (raw = await readJsonFile(legacyConfigFile())) !== null;

  config.lang = I18n.normalize(raw?.lang);
  if (!raw || !Array.isArray(raw.roots)) {
    config.roots = defaultRoots(home);
    return;
  }
  config.roots = raw.roots.filter((r) => typeof r === 'string');
  // v1 → v2 : ajout des nouveaux dossiers par défaut (ex. ~/.claude/agents)
  if ((raw.version || 1) < CONFIG_VERSION) {
    for (const r of defaultRoots(home)) if (!config.roots.includes(r)) config.roots.push(r);
  }
  if (migrated || (raw.version || 1) < CONFIG_VERSION) await saveConfig();
}

async function saveConfig() {
  await fs.mkdir(path.dirname(configFile()), { recursive: true });
  await fs.writeFile(configFile(), JSON.stringify(config, null, 2));
}

const rootsInfo = () => Promise.all(config.roots.map(async (p) => ({ path: p, exists: await isDir(p) })));

function getSkill(id) {
  const s = registry.get(id);
  if (!s) throw new Error(tr('err.unknown'));
  return s;
}

/* ---------- IPC ---------- */

ipcMain.handle('skills:scan', async () => {
  const skills = await scanSkills(config.roots, home);
  registry.clear();
  for (const s of skills) registry.set(s.id, { file: s.id, shown: s.path, eol: '\n' });
  return { home, roots: await rootsInfo(), skills };
});

ipcMain.handle('skills:read', async (_e, id) => {
  const s = getSkill(id);
  const [raw, st] = await Promise.all([fs.readFile(s.file, 'utf8'), fs.stat(s.file)]);
  s.eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { content: raw.replace(/\r\n/g, '\n'), mtimeMs: st.mtimeMs };
});

ipcMain.handle('skills:stat', async (_e, id) => ({ mtimeMs: (await fs.stat(getSkill(id).file)).mtimeMs }));

ipcMain.handle('skills:write', async (_e, id, content, expectedMtime) => {
  const s = getSkill(id);
  if (typeof content !== 'string') throw new Error(tr('err.invalid'));

  const st = await fs.stat(s.file).catch(() => null);
  if (st && typeof expectedMtime === 'number' && Math.abs(st.mtimeMs - expectedMtime) > 1) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: [tr('dlg.conflict.overwrite'), tr('dlg.conflict.reload'), tr('dlg.cancel')],
      defaultId: 2,
      cancelId: 2,
      message: tr('dlg.conflict.message'),
      detail: s.shown,
    });
    if (response === 1) return { status: 'reload' };
    if (response === 2) return { status: 'cancelled' };
  }

  await fs.writeFile(s.file, s.eol === '\n' ? content : content.replace(/\n/g, s.eol), 'utf8');
  return { status: 'saved', mtimeMs: (await fs.stat(s.file)).mtimeMs };
});

ipcMain.handle('skills:reveal', (_e, id) => shell.showItemInFolder(getSkill(id).shown));
ipcMain.handle('skills:open', async (_e, id) => {
  const err = await shell.openPath(getSkill(id).file);
  if (err) throw new Error(err);
});

ipcMain.handle('roots:add', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: tr('dlg.addRoot.title'),
    defaultPath: home,
    properties: ['openDirectory', 'multiSelections', 'showHiddenFiles'],
  });
  if (canceled || !filePaths.length) return false;
  for (const p of filePaths) if (!config.roots.includes(p)) config.roots.push(p);
  await saveConfig();
  return true;
});

ipcMain.handle('roots:remove', async (_e, p) => {
  config.roots = config.roots.filter((r) => r !== p);
  await saveConfig();
});

ipcMain.handle('roots:reset', async () => {
  config.roots = defaultRoots(home);
  await saveConfig();
});

ipcMain.handle('dialog:unsaved', async (_e, name) => {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [tr('dlg.save'), tr('dlg.dontSave'), tr('dlg.cancel')],
    defaultId: 0,
    cancelId: 2,
    message: tr('dlg.unsaved.message', { name }),
    detail: tr('dlg.unsaved.detail'),
  });
  return ['save', 'discard', 'cancel'][response];
});

ipcMain.handle('i18n:get', () => config.lang);
ipcMain.handle('i18n:set', async (_e, lang) => {
  config.lang = I18n.normalize(lang);
  await saveConfig();
  buildMenu();
  return config.lang;
});

ipcMain.on('state:dirty', (_e, value) => {
  dirty = Boolean(value);
  if (isMac) win?.setDocumentEdited(dirty);
});

ipcMain.on('app:close-now', () => {
  dirty = false;
  win?.close();
});

/* ---------- Fenêtre ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 820,
    minHeight: 520,
    title: 'Skills Book',
    show: false,
    backgroundColor: isMac ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 }, vibrancy: 'sidebar', visualEffectState: 'active' }
      : { autoHideMenuBar: true }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Liens du preview : jamais de navigation dans la fenêtre, http(s) dans le navigateur.
  const openExternal = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) { e.preventDefault(); openExternal(url); }
  });

  win.on('close', (e) => {
    if (!dirty) return;
    e.preventDefault();
    const response = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: [tr('dlg.save'), tr('dlg.dontSave'), tr('dlg.cancel')],
      defaultId: 0,
      cancelId: 2,
      message: tr('dlg.close.message'),
    });
    if (response === 0) win.webContents.send('app:save-then-close');
    else if (response === 1) { dirty = false; win.close(); }
  });

  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const send = (channel) => () => win?.webContents.send(channel);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: tr('menu.file'),
      submenu: [
        { label: tr('menu.save'), accelerator: 'CmdOrCtrl+S', click: send('menu:save') },
        { type: 'separator' },
        { label: tr('menu.find'), accelerator: 'CmdOrCtrl+F', click: send('menu:find') },
        { label: tr('menu.rescan'), accelerator: 'CmdOrCtrl+R', click: send('menu:rescan') },
        { label: tr('menu.addRoot'), accelerator: 'CmdOrCtrl+O', click: send('menu:add-root') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit', label: tr('menu.quit') }]),
      ],
    },
    {
      label: tr('menu.edit'),
      submenu: [
        { role: 'undo', label: tr('menu.undo') },
        { role: 'redo', label: tr('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: tr('menu.cut') },
        { role: 'copy', label: tr('menu.copy') },
        { role: 'paste', label: tr('menu.paste') },
        { role: 'selectAll', label: tr('menu.selectAll') },
      ],
    },
    {
      label: tr('menu.view'),
      submenu: [
        { role: 'reload', label: tr('menu.reload'), accelerator: 'CmdOrCtrl+Shift+R' },
        { role: 'toggleDevTools', label: tr('menu.devtools') },
        { type: 'separator' },
        { role: 'resetZoom', label: tr('menu.resetZoom') },
        { role: 'zoomIn', label: tr('menu.zoomIn') },
        { role: 'zoomOut', label: tr('menu.zoomOut') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: tr('menu.fullscreen') },
      ],
    },
    {
      label: tr('menu.window'),
      role: 'window',
      submenu: [
        { role: 'minimize', label: tr('menu.minimize') },
        ...(isMac ? [{ role: 'zoom', label: tr('menu.zoom') }] : []),
        { role: 'close', label: tr('menu.closeWindow') },
      ],
    },
  ]));
}

app.whenReady().then(async () => {
  await loadConfig();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });
