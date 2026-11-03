---
name: test-update-flow
description: Tests the in-app updater of Skills Book (launch check, Check for Updates menu, dialogs, progress and error states) against a local mock GitHub release feed, and gives the manual plan for real installs on macOS and Windows. Use when changing src/updater.js, src/update-core.js, release asset names, the repository field or the release workflow.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/mock-feed.mjs *) Bash(npm test)
---

# Test the update flow

The updater has two halves: `src/update-core.js` (no Electron, unit-tested) and `src/updater.js` (dialogs, download, install on quit). Packaged builds always query GitHub; from source, `SKILLS_BOOK_UPDATE_FEED` replaces the GitHub URL and also enables the launch check.

## 1. Unit tests

```bash
npm test
```

Covers asset choice (arm64, x64, Rosetta, Windows), API mapping (200, 404, 500, pre-release), download (redirect, progress, cache, wrong digest) and the macOS bundle swap. Add a test there for any new core behavior.

## 2. Dialogs and menu, from source

Start the mock feed (keep it running), then the app in another terminal:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/mock-feed.mjs --version 9.9.9     # modes: --mode available|none|error
SKILLS_BOOK_UPDATE_FEED=http://127.0.0.1:8787/latest npm start
```

Expected, about 3 s after the window shows:

| Mock | Launch check | *Check for Updates…* (app menu on macOS, Help on Windows/Linux) |
|---|---|---|
| `available` (newer than `package.json`) | "Skills Book 9.9.9 is available", buttons *Release Notes / Later* | same dialog |
| `available` with `--version` ≤ current | nothing | "Skills Book is up to date" |
| `none` (404) | nothing | "Skills Book is up to date" |
| `error` (500) | nothing (a `[update]` warning in the terminal) | "Couldn't check for updates" + `GitHub API: HTTP 500` |

Switch modes without restarting: `curl http://127.0.0.1:8787/mode/error`. Repeat in French (language picker) to check the strings.

From source the dialog never offers *Update and Restart*: installing needs a packaged app. To check the progress UI, send a status from the main process (DevTools of the main process, or a test harness with Playwright `_electron`):

```js
BrowserWindow.getAllWindows()[0].webContents.send('update:status', { state: 'downloading', version: '9.9.9', percent: 42 });
// other states: { state: 'installing', version }, { state: 'deferred', version }, { state: 'error', message }, { state: 'idle' }
```

## 3. Real install (packaged builds, two releases)

1. Install release N from GitHub (macOS: copy to Applications, run `xattr -cr "/Applications/Skills Book.app"` once).
2. Merge a PR that bumps to N+1 and wait for the *Release* job.
3. Launch N: the dialog must offer *Update and Restart*. Click it and watch the progress.
4. The app must restart on N+1: *Check for Updates…* now answers "Version N+1 is the latest version" (or *About* on macOS). Then check:
   - macOS: `/Applications/Skills Book.app` replaced; `.Skills Book.app.update` and `.Skills Book.app.old` gone after the next launch.
   - Windows: installed in the same folder, shortcuts kept.
5. Edge cases: unsaved edit then *Update and Restart* → *Cancel* in the save prompt → toast "installed when you quit", the update is applied on quit; app launched from the dmg or a read-only folder → the dmg opens for a manual install.

For logs, start the packaged app from a terminal: `"/Applications/Skills Book.app/Contents/MacOS/Skills Book"` on macOS. Lines start with `[update]`.

## Contracts to keep

- Asset names `skills-book-<version>-mac-<arch>.dmg` and `skills-book-<version>-win-setup.exe` (`artifactName` in `package.json`) must stay matched by `pickAsset()`, or installed apps stop finding updates.
- `repository` in `package.json` selects the GitHub repo.
- The release job publishes the digests the updater verifies; never edit release assets by hand.
