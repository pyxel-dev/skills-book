# Skills Book

[![Build](https://github.com/pyxel-dev/skills-book/actions/workflows/build.yml/badge.svg)](https://github.com/pyxel-dev/skills-book/actions/workflows/build.yml)

Electron app (macOS / Windows) that lists the skills and agents on your machine and lets you edit them as Markdown.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img alt="Skills Book: skills grouped by scope in the sidebar, with the Markdown editor and live preview side by side" src="docs/screenshot.png">
</picture>

```bash
npm install
npm start
```

## Build

```bash
npm run dist:mac   # dmg arm64 + x64
npm run dist:win   # NSIS installer x64 + arm64 (run on Windows)
```

Output goes to `dist/`. Builds are not signed with a developer certificate (ad-hoc signature on macOS).

## Downloads

Every push to `main` builds the app with GitHub Actions ([`build.yml`](.github/workflows/build.yml)); it can also be started by hand from the Actions tab. Open the latest [Build run](https://github.com/pyxel-dev/skills-book/actions/workflows/build.yml) and download its artifacts (kept 30 days):

- `skills-book-macos-<sha>`: `.dmg` for Apple Silicon (`-arm64`) and Intel
- `skills-book-windows-<sha>`: NSIS installer (x64 + arm64)

Since the builds are unsigned:

- **macOS**: after copying the app to Applications, run `xattr -cr "/Applications/Skills Book.app"` once, otherwise macOS reports it as damaged.
- **Windows**: SmartScreen shows a warning; choose *More info* → *Run anyway*.

## How it works

- **Skills / Agents tabs**. Skill = folder containing a `SKILL.md`. Agent = `.md` file with frontmatter inside an `agents/` folder of `.claude` or of a plugin (subfolders included).
- **Scope**:
  - `Global`: under a config folder in your home directory (`~/.claude`, `~/.codex`, `~/.agents`…), installed plugins included.
  - `Local`: under `<project>/.claude` (or `.codex`, `.agents`…).
  - `Other`: any folder outside a config folder.
  Collapsible groups by source (config, plugin, project), with an All / Global / Local filter.
- **Scanned folders** (button at the bottom of the sidebar): by default `~/.claude/skills`, `~/.claude/agents`, `~/.claude/plugins`, `~/.agents/skills`, `~/.codex/skills`. Add `~/dev` (or similar) to see the local skills/agents of your projects. Config is stored in `userData/config.json`.
- Recursive scan (depth 9), skips `node_modules`, `.git`, `dist`, `build`, etc. In `~/.claude/plugins`, only what is actually loaded is listed (`cache/`, `synced/`), not the `marketplaces/` catalog or orphaned versions (`.orphaned_at`). Symlinks are followed and duplicates merged.
- **Language**: picker at the bottom of the sidebar (English by default, French). Covers the UI, native dialogs and menus; the choice is saved in `config.json`.
- Name and description come from the frontmatter (`name`, `description`), otherwise from the folder/file name.
- EasyMDE editor: preview, side by side, frontmatter rendered as a table in the preview.
- Saving: original line endings are kept (LF/CRLF), external changes are detected (auto-reload when there are no local edits, otherwise a choice between Overwrite / Reload).

## Shortcuts

| | |
|---|---|
| `⌘/Ctrl S` | Save |
| `⌘/Ctrl F` | Filter the list |
| `⌘/Ctrl R` | Rescan |
| `⌘/Ctrl O` | Add a folder |
| `⌘/Ctrl P` | Preview |
| `F9` | Side by side |

## Structure

```
src/
  main.js                 main process, IPC, menu, dialogs
  preload.js              API exposed through contextBridge
  scanner.js              finds skills (SKILL.md) and agents
  shared/frontmatter.js   minimal YAML parser (main + renderer)
  shared/i18n.js          translations (main + renderer): adding a language = one entry in LANGS + dict
  renderer/               UI (HTML/CSS/JS, no bundler)
```

Security: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP. The main process only allows reading/writing files returned by the latest scan.
