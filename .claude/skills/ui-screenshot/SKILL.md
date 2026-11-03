---
name: ui-screenshot
description: Captures the Skills Book window with neutral demo data (global skills, a plugin, agents, a local project) in light and dark mode at 2x, to check a UI change or refresh the README screenshots in docs/. Use after visual changes to the renderer, before opening a PR with UI changes, or when docs/screenshot*.png are outdated.
argument-hint: "[--theme light|dark|both] [--open <item>] [--out <dir>]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/*) Bash(xvfb-run *) Bash(npm i --no-save playwright-core)
---

# UI screenshots

`scripts/capture.mjs` creates demo data (`scripts/demo-home.mjs`), launches the app from source with Playwright's Electron driver, opens an item in side-by-side mode and writes `screenshot.png` / `screenshot-dark.png` (window 1280×800, 2x). The app runs with `SKILLS_BOOK_HOME` and `SKILLS_BOOK_USER_DATA` pointing at the demo folders, so the real config and skills are never read or modified.

## Setup (once per checkout)

```bash
npm i --no-save playwright-core   # not a project dependency: don't commit it to package.json
```

## Capture

```bash
# macOS / Windows (a window opens briefly)
node ${CLAUDE_SKILL_DIR}/scripts/capture.mjs $ARGUMENTS

# Linux / headless
xvfb-run -a -s "-screen 0 2800x1800x24" node ${CLAUDE_SKILL_DIR}/scripts/capture.mjs $ARGUMENTS
```

Options: `--out <dir>` (default `docs/`, which overwrites the README screenshots), `--theme light|dark|both`, `--open <item name>` (default `deploy`), `--no-side` (editor only), `--lang en|fr`.

To check a change without touching `docs/`, pass `--out` to a temporary folder, then look at both images: layout, overflow, contrast in dark mode, nothing cut off in the sidebar.

## Refreshing the README screenshots

Run with the default `--out`, look at both files, and commit `docs/screenshot.png` and `docs/screenshot-dark.png` with the UI change. The output is deterministic for a given UI: if `git status` shows them modified, the UI really changed. Captures made on Linux use the Inter font and have no macOS window buttons; a capture made on a Mac is fine too.

## Changing the demo data

Edit `scripts/demo-home.mjs`. Keep it neutral (no real names, companies or personal paths), with at least one global skill, one plugin, one local project and agents, so every scope and group type shows up.
