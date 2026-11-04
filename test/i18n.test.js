'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I18n = require('../src/shared/i18n');

const root = path.join(__dirname, '..');
const { dict, LANGS, DEFAULT } = I18n;
const base = dict[DEFAULT];
const placeholders = (value) => (typeof value === 'string' ? [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort() : null);

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(js|html)$/.test(e.name) ? [full] : [];
  });
}

test('every language listed in LANGS has a dictionary, and vice versa', () => {
  assert.deepEqual(Object.keys(dict).sort(), Object.keys(LANGS).sort());
});

for (const lang of Object.keys(LANGS).filter((l) => l !== DEFAULT)) {
  test(`${lang}: same keys as ${DEFAULT}`, () => {
    const missing = Object.keys(base).filter((k) => !(k in dict[lang]));
    const extra = Object.keys(dict[lang]).filter((k) => !(k in base));
    assert.deepEqual({ missing, extra }, { missing: [], extra: [] });
  });

  test(`${lang}: same placeholders and value types as ${DEFAULT}`, () => {
    for (const [key, value] of Object.entries(dict[lang])) {
      if (!(key in base)) continue;
      assert.equal(typeof value, typeof base[key], `type of ${key}`);
      assert.deepEqual(placeholders(value), placeholders(base[key]), `placeholders of ${key}`);
      if (typeof value === 'function') {
        for (const n of [1, 2]) assert.equal(typeof value({ n }), 'string', `${key}({ n: ${n} })`);
      }
    }
  });
}

test('every key used in the sources exists', () => {
  const used = new Map(); // key -> file
  const add = (key, file) => { if (!used.has(key)) used.set(key, path.relative(root, file)); };

  for (const file of sourceFiles(path.join(root, 'src'))) {
    const src = fs.readFileSync(file, 'utf8');
    // t('key') in the renderer, tr('key') in the main process
    for (const m of src.matchAll(/\b(?:t|tr)\(\s*'([\w.-]+)'/g)) add(m[1], file);
    // data-i18n, data-i18n-title, data-i18n-placeholder in HTML
    for (const m of src.matchAll(/data-i18n(?:-title|-placeholder)?="([\w.-]+)"/g)) add(m[1], file);
    // Editor toolbar: titles are `tb.<name>` built from the TOOLS table
    for (const m of src.matchAll(/\['([\w-]+)', EasyMDE\./g)) add(`tb.${m[1]}`, file);
  }

  // Keys built dynamically (template literals) in the renderer
  for (const scope of ['all', 'global', 'local', 'other']) add(`scope.${scope}`, 'src/renderer/app.js');
  for (const scope of ['global', 'local', 'other']) add(`scope.${scope}.title`, 'src/renderer/app.js');
  for (const kind of ['skill', 'agent']) { add(`kind.${kind}`, 'src/renderer/app.js'); add(`count.${kind}`, 'src/renderer/app.js'); }
  for (const p of ['darwin', 'win32', 'other']) add(`action.reveal.${p}`, 'src/renderer/app.js');
  for (const code of ['no_key', 'no_model', 'auth', 'unreachable', 'failed', 'key_unreadable', 'invalid_url', 'encryption_unavailable']) add(`ai.err.${code}`, 'src/ai.js');
  for (const id of ['anthropic', 'openai', 'local']) add(`ai.provider.${id}`, 'src/renderer/ai-panel.js');
  for (const outcome of ['applied', 'ignored']) add(`ai.${outcome}`, 'src/renderer/ai-panel.js');
  for (const key of ['settings.key.placeholder', 'settings.key.saved', 'settings.key.optional']) add(key, 'src/renderer/settings-view.js');
  for (const key of ['ai.send', 'ai.stop']) add(key, 'src/renderer/ai-panel.js');

  const unknown = [...used].filter(([key]) => !(key in base)).map(([key, file]) => `${key} (${file})`);
  assert.deepEqual(unknown, []);
  assert.ok(used.size > 50, `only ${used.size} keys found: the extraction patterns are probably broken`);
});
