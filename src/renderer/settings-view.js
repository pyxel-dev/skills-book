'use strict';
/* Settings view: API keys and local server URL. The language select (#lang) is handled by app.js. */
window.SettingsView = (() => {
  function init({ api, t, toast, errMsg, onChange }) {
    const $ = (id) => document.getElementById(id);
    const view = $('settings');
    const keyForms = [...view.querySelectorAll('form[data-key]')];
    let settings = null;

    function placeholder(id) {
      if (settings.hasKey[id]) return t('settings.key.saved');
      return t(id === 'local' ? 'settings.key.optional' : 'settings.key.placeholder');
    }

    function render() {
      if (!settings) return;
      for (const form of keyForms) {
        form.querySelector('input').placeholder = placeholder(form.dataset.key);
        form.querySelector('.ghost').hidden = !settings.hasKey[form.dataset.key];
      }
    }

    async function update(call) {
      try {
        settings = await call();
        render();
        onChange(settings);
        return true;
      } catch (e) {
        toast(errMsg(e), 'error');
        return false;
      }
    }

    for (const form of keyForms) {
      const id = form.dataset.key;
      const input = form.querySelector('input');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const value = input.value.trim();
        if (value && await update(() => api.aiSetKey(id, value))) input.value = '';
      });
      form.querySelector('.ghost').addEventListener('click', () => update(() => api.aiSetKey(id, '')));
    }

    $('settings-url-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await update(() => api.aiSetSettings({ localUrl: $('settings-url').value }))) $('settings-url').value = settings.localUrl;
    });

    async function open() {
      settings = await api.aiGetSettings();
      for (const form of keyForms) form.querySelector('input').value = '';
      $('settings-url').value = settings.localUrl;
      render();
      view.hidden = false;
    }
    const close = () => { view.hidden = true; };

    $('btn-settings').addEventListener('click', open);
    $('settings-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !view.hidden) close(); });

    return { open, close, applyLang: render };
  }

  return { init };
})();
