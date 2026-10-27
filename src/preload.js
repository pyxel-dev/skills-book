'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['menu:save', 'menu:find', 'menu:rescan', 'menu:add-root', 'app:save-then-close']);

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  scan: () => ipcRenderer.invoke('skills:scan'),
  read: (id) => ipcRenderer.invoke('skills:read', id),
  stat: (id) => ipcRenderer.invoke('skills:stat', id),
  write: (id, content, mtimeMs) => ipcRenderer.invoke('skills:write', id, content, mtimeMs),
  reveal: (id) => ipcRenderer.invoke('skills:reveal', id),
  openExternal: (id) => ipcRenderer.invoke('skills:open', id),

  addRoot: () => ipcRenderer.invoke('roots:add'),
  removeRoot: (p) => ipcRenderer.invoke('roots:remove', p),
  resetRoots: () => ipcRenderer.invoke('roots:reset'),

  getLang: () => ipcRenderer.invoke('i18n:get'),
  setLang: (lang) => ipcRenderer.invoke('i18n:set', lang),

  confirmUnsaved: (name) => ipcRenderer.invoke('dialog:unsaved', name),
  setDirty: (value) => ipcRenderer.send('state:dirty', value),
  closeNow: () => ipcRenderer.send('app:close-now'),

  on(channel, cb) {
    if (!EVENTS.has(channel)) throw new Error(`Event not allowed: ${channel}`);
    const handler = () => cb();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
