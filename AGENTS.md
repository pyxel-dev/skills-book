# Skills Book: guide for contributors and coding agents

Electron desktop app (macOS + Windows) that lists the Claude skills (`SKILL.md`) and agents on the machine and edits them in a Markdown editor. Plain JavaScript, no bundler, no framework, no TypeScript.

## Commands

```bash
npm install
npm start                                   # run from source
npm test                                    # unit tests (node --test, no dependencies)
npm run dist:mac -- --dir                   # quick unpacked build (drop --dir for the dmg)
npm run dist:win                            # NSIS installer (run on Windows)
npm version patch --no-git-tag-version      # bump (patch | minor | major), required on every PR
git fetch origin main && node scripts/check-version.mjs origin/main   # same check as CI
```

## Rules

- **English everywhere** in the repo: code, comments, test names, commits, PR titles and bodies, docs. User-facing text goes through i18n only (English + French), never hard-coded.
- **Every PR to `main` bumps `version`** in `package.json` and `package-lock.json`. The required *Version bump* check fails otherwise, and the ruleset requires the branch to be up to date with `main`. Never create or push tags: CI does it.
- **PR titles become release notes** (`gh release create --generate-notes`): write them for users.
- **No direct pushes to `main`.** Work on a branch, open a PR.
- **No new runtime dependency** without a strong reason. Tests must stay dependency-free.
- **Keep docs in sync**: README (How it works, Shortcuts, Structure, Downloads, Updates, Releasing) and this file when architecture or conventions change.

## Layout

```
src/main.js              window, menus, config, IPC handlers, native dialogs
src/preload.js           window.api (contextBridge); EVENTS = allowed main → renderer channels
src/scanner.js           finds skills and agents, classifies scope, plugin info
src/updater.js           update check / download / install (Electron side)
src/update-core.js       Electron-free update logic (unit-tested)
src/ai.js                AI chat IPC handlers and encrypted key storage (Electron side)
src/ai-core.js           Electron-free AI logic: requests, errors, URL validation (unit-tested)
src/shared/frontmatter.js  minimal YAML frontmatter parser (UMD: main + renderer)
src/shared/i18n.js         EN/FR strings (UMD: main + renderer)
src/shared/semver.js       semver helpers (updater + scripts/check-version.mjs)
src/shared/proposal.js     AI proposal extraction and line diff (UMD: renderer + tests)
src/renderer/            index.html, app.js (UI state, list, editor), ai-panel.js, settings-view.js, icons.js, styles.css
scripts/check-version.mjs  version check used by CI
test/                    node:test suites
.github/workflows/       build.yml (build + release), version-check.yml, test.yml
docs/                    README screenshots
```

The renderer loads scripts with `<script>` tags (UMD globals: `window.api`, `Frontmatter`, `I18n`, `Icons`, `EasyMDE`, `Proposal`, `AiPanel`, `SettingsView`). EasyMDE is loaded from `node_modules/easymde/dist/` by relative path; electron-builder ships it in the asar.

## Security model (keep it)

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP in `index.html` (no inline scripts, no remote code).
- The renderer never sends file paths. `skills:scan` fills `registry` (id = real path → file); read, write, reveal and open take an **id** and throw if it is not in the last scan. Folder roots are added only through the native folder dialog.
- New IPC: `ipcMain.handle` in `main.js`, validate every argument, expose a narrow function in `preload.js`. A new main → renderer event must be added to `EVENTS` (or get a dedicated `on…` helper like `onUpdateStatus`).
- Links in the preview never navigate the window; `http(s)` URLs open in the browser.
- AI requests run in the main process, so the CSP keeps blocking network access from the renderer. API keys are encrypted with `safeStorage`, never returned to the renderer and never stored in plaintext. Provider, model and URL come from the config, never from `ai:send`. Requests refuse redirects, `http` is accepted only on loopback, and changing the local URL deletes its key.
- AI replies are displayed with `textContent`, never rendered as Markdown or HTML: an opened file may carry prompt injection, and the CSP's `img-src https:` would let a rendered image leak its content. The model has no tools; it can only propose text, which the user reviews as a diff.

## How things work

- **Scanner**: walks the configured roots (depth 9), skips `node_modules`, `.git`, build folders and inactive `~/.claude` content. Skill = folder with `SKILL.md` (not descended further). Agent = `.md` with a `name` or `description` in its frontmatter inside an `agents/` folder of `.claude` or of a plugin. Scope: under `~/.claude`, `~/.codex`, `~/.agents`… = global; under `<project>/.claude`… = local; elsewhere = other. In `~/.claude/plugins` only `cache/` and `synced/` are read, and versions marked `.orphaned_at` are skipped.
- **Saving** keeps the file's line endings (LF/CRLF) and compares the mtime to detect external edits (overwrite / reload dialog).
- **Config**: `<userData>/config.json` = `{ version, lang, roots, ai }`; `CONFIG_VERSION` + `loadConfig()` handle migrations, including the former `Skills Manager` userData folder. Bumping `CONFIG_VERSION` adds the default folders back, so optional fields like `ai` are normalized instead. Per-viewer UI state (tab, scope filter, collapsed groups, sidebar width, last file) lives in `localStorage`.
- **i18n**: `t(key, params)` in the renderer, `tr(key, params)` in main; `data-i18n`, `data-i18n-title`, `data-i18n-placeholder` in HTML; `applyLang()` re-renders and `buildMenu()` rebuilds menus on language change. See the `add-ui-text` skill.
- **AI chat**: `ai-panel.js` sends the editor text and the conversation through `ai:send`, and `ai-core.js` calls Anthropic's Messages API or the OpenAI format (OpenAI, Ollama, LM Studio) without streaming. Proposals come back as the complete file in a `<proposed_file>` block; `shared/proposal.js` extracts it and computes the diff. Apply goes through `mde.value()`, not `setEditorValue()`, to keep the undo history. Conversations stay in memory, one per file.
- **Releases**: a push to `main` runs `build.yml`: dmg (arm64 + x64) on `macos-latest`, NSIS (x64 + arm64) on `windows-latest`, then the *Release* job publishes `v<version>`. A version with a suffix (`1.2.0-beta.1`) becomes a GitHub pre-release. Manual runs only build.
- **Updates**: the packaged app reads `releases/latest` 3 s after launch and from *Check for Updates…*. It downloads the asset for the platform, verifies the GitHub SHA-256 digest, then on quit: macOS swaps the bundle copied from the dmg (`hdiutil` + `ditto`), Windows runs the installer with `/S --updated --force-run`. Squirrel/electron-updater is not used because the builds are only ad-hoc signed.

## Contracts that break installed apps if changed

- **Asset names** (`build.mac.artifactName`, `build.nsis.artifactName`: `skills-book-<version>-mac-<arch>.dmg`, `skills-book-<version>-win-setup.exe`) are matched by `pickAsset()` in `update-core.js`. Changing them means existing installs can't find their update: keep `pickAsset()` compatible with both old and new names for a while.
- **`repository`** in `package.json` tells the updater which GitHub repo to query.
- **`productName`** sets the userData folder, the macOS bundle and executable names: renaming needs a config migration (see `legacyConfigFile()` in `main.js`) and care in the updater.
- **macOS signing**: `build.mac.identity: "-"` (ad-hoc) and `hardenedRuntime: false`. Moving to a Developer ID certificate means removing `identity`, enabling hardened runtime and notarization; electron-updater would then become an option.

## Conventions

- Two-space indentation, single quotes, semicolons, `'use strict'` in CommonJS files; match the surrounding style.
- Comments explain why, not what. Keep functions small; Electron-free logic goes in modules that can be unit-tested without Electron (like `update-core.js`).
- Cross-platform: use `path` helpers, never hard-code `/`; check both `isMac` branches (menus, window chrome, reveal-in-folder labels). Windows hides the menu bar (`autoHideMenuBar`).
- CSS: colors are tokens on `:root`, dark mode through `prefers-color-scheme`. Icons are Lucide paths in `icons.js`, used with `data-icon="name"` or `Icons.svg(name)`.
- French UI strings use the informal "tu", French quotes « » and typographic apostrophes (’).

## Testing

- `npm test` covers semver, the updater core (asset choice, API mapping, download with digest, bundle swap), the AI core (requests, errors, URL validation), proposals (extraction, diff) and i18n (key parity, placeholders, every used key exists). Add tests for new Electron-free logic.
- UI changes: no automated UI test in CI. Use the `ui-screenshot` skill to check the window in light and dark mode, and refresh `docs/screenshot*.png` when the main screen changes.
- Updater changes: use the `test-update-flow` skill (mock release feed). Real installs can only be tested with packaged builds on macOS and Windows.

### Development-only environment variables (ignored in packaged builds)

| Variable | Effect |
|---|---|
| `SKILLS_BOOK_HOME` | Home folder used for default roots, `~` display and scope classification |
| `SKILLS_BOOK_USER_DATA` | userData folder (config + localStorage) |
| `SKILLS_BOOK_UPDATE_FEED` | URL returning a release JSON in the GitHub API format; also enables the launch check from source |
