---
name: add-ui-text
description: Adds, changes or removes user-visible text in Skills Book (labels, tooltips, placeholders, toasts, native dialogs, menus) through src/shared/i18n.js, in English and French, and wires it in the renderer or the main process. Also covers adding a UI language. Use whenever a change touches a string shown to users.
---

# User-visible text

All UI text lives in `src/shared/i18n.js` (`dict.en` and `dict.fr`). English is the default and the fallback. Never hard-code text in HTML, JS or native dialogs.

## 1. Add the key to every language

- Name: `area.thing` in camelCase segments (`update.downloading`, `roots.add`, `dlg.unsaved.message`). Reuse an existing area: `tab`, `scope`, `list`, `roots`, `action`, `doc`, `toast`, `tb` (editor toolbar), `status`, `dlg`, `err`, `menu`, `update`.
- Put it in the same section and position in `en` and `fr`.
- Parameters use `{name}`: `'update.available': 'Skills Book {version} is available'`. Every language must use the same placeholders.
- Plurals or logic: a function of the params, as in `'count.skill': ({ n }) => plural(n, 'skill', 'skills')`.

Style:

- English: sentence case for labels and toasts (`Add a folder…`); Title Case for menu items and dialog buttons, following macOS/Windows conventions (`Check for Updates…`, `Update and Restart`); `…` (one character) when the action opens a dialog.
- French: informal "tu" (`Sélectionne un élément`), « » quotes, ’ apostrophes, `…`.

## 2. Use it

Renderer (`src/renderer/`):

- Static markup: `data-i18n="key"` (text), `data-i18n-title="key"`, `data-i18n-placeholder="key"`. `applyLang()` fills them.
- Dynamic content: `t('key', { param })` inside a render function (`renderList`, `renderHeader`, `renderRoots`, `renderUpdate`…). A new render function that uses `t()` must also be called from `applyLang()`, otherwise switching language leaves stale text.
- Editor toolbar buttons: the key is `tb.<name>` from the `TOOLS` table in `app.js`.
- Prefer literal keys (`t('toast.saved')`). Keys built with template literals are invisible to the tests: list them in the "dynamic keys" block of `test/i18n.test.js`.

Main process (`src/main.js`, `src/updater.js`):

- `tr('key', params)` reads the current language at call time; call it when the dialog or menu is built, never at module load.
- Menus are rebuilt by `buildMenu()` when the language changes (`i18n:set`), so new menu labels only need `tr()`.

## 3. Check

```bash
npm test
```

`test/i18n.test.js` fails on a key missing in a language, different placeholders between languages, or a key used in `src/` that doesn't exist. Then switch the language in the app (picker at the bottom of the sidebar) and check that the text fits; French is usually about 20 % longer.

## Removing or renaming a key

Remove it from every language and search for remaining uses (`grep -rn "old.key" src`); the test catches literal uses but not dynamic ones.

## Adding a language

1. Add `code: 'Native name'` to `LANGS` and a complete `dict.<code>` (copy `en`, translate every value, keep the placeholders).
2. `npm test` enforces full parity with English.
3. Check the sidebar, dialogs and menus in that language for overflowing text.
