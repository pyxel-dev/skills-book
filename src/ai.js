'use strict';
// Electron side of the AI chat: IPC handlers and key encryption. The logic is in ai-core.js.
const { ipcMain, net, safeStorage } = require('electron');
const core = require('./ai-core');

function registerAi({ getConfig, saveConfig, tr }) {
  const requests = new Map(); // requestId -> AbortController
  const ai = () => getConfig().ai;
  const invalid = () => new Error(tr('err.invalid'));

  const settings = () => ({
    provider: ai().provider,
    models: ai().models,
    localUrl: ai().localUrl,
    hasKey: Object.fromEntries(core.PROVIDER_IDS.map((id) => [id, Boolean(ai().keys[id])])),
  });

  function readKey(provider) {
    const stored = ai().keys[provider];
    if (!stored) return '';
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      throw new core.AiError('key_unreadable');
    }
  }

  /** Provider, key and URL always come from the config, never from the renderer. */
  function target() {
    const { provider, localUrl, models } = ai();
    const key = readKey(provider);
    if (!key && provider !== 'local') throw new core.AiError('no_key');
    return { provider, key, localUrl, model: models[provider] };
  }

  const handle = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof core.AiError) throw new Error(tr(`ai.err.${e.code}`, { detail: e.detail }));
      throw e;
    }
  });

  handle('ai:settings:get', settings);

  handle('ai:settings:set', async (patch) => {
    if (!patch || typeof patch !== 'object') throw invalid();
    if (patch.provider !== undefined) {
      if (!core.PROVIDER_IDS.includes(patch.provider)) throw invalid();
      ai().provider = patch.provider;
    }
    if (patch.model !== undefined) {
      if (typeof patch.model !== 'string' || patch.model.length > 200) throw invalid();
      ai().models[ai().provider] = patch.model.trim();
    }
    if (patch.localUrl !== undefined) {
      const url = core.validateLocalUrl(patch.localUrl);
      if (url !== ai().localUrl) {
        ai().localUrl = url;
        // A compromised renderer must not be able to send the key to another server.
        delete ai().keys.local;
      }
    }
    await saveConfig();
    return settings();
  });

  handle('ai:key:set', async (provider, key) => {
    if (!core.PROVIDER_IDS.includes(provider) || typeof key !== 'string') throw invalid();
    const value = key.trim();
    if (!value) {
      delete ai().keys[provider];
    } else {
      if (!safeStorage.isEncryptionAvailable()) throw new core.AiError('encryption_unavailable');
      ai().keys[provider] = safeStorage.encryptString(value).toString('base64');
    }
    await saveConfig();
    return settings();
  });

  handle('ai:models', () => core.listModels({ fetch: net.fetch, ...target() }));

  handle('ai:send', async (requestId, document, messages) => {
    if (typeof requestId !== 'string' || typeof document !== 'string' || !core.validMessages(messages)) throw invalid();
    const destination = target();
    if (!destination.model) throw new core.AiError('no_model');
    const controller = new AbortController();
    requests.set(requestId, controller);
    try {
      return await core.chat({ fetch: net.fetch, ...destination, document, messages, signal: controller.signal });
    } catch (e) {
      if (controller.signal.aborted) return null;
      throw e;
    } finally {
      requests.delete(requestId);
    }
  });

  handle('ai:cancel', (requestId) => { requests.get(requestId)?.abort(); });
}

module.exports = { registerAi };
