---
name: prepare-pr
description: Gets a finished change in Skills Book ready for a pull request to main. Picks and applies the version bump every PR needs, runs the tests and the CI version check, updates README/AGENTS.md and screenshots, then writes the commit and PR in English with a release-note title. Use when a change is ready to commit, push or open as a PR, or when asked to ship or release.
argument-hint: "[patch|minor|major]"
allowed-tools: Bash(npm test) Bash(npm version *) Bash(git fetch origin main) Bash(node scripts/check-version.mjs *)
---

# Prepare a pull request

Every PR to `main` ships as a release. The required **Version bump** check blocks the merge until the version is bumped, the ruleset requires the branch to be up to date with `main`, and merging publishes `v<version>` with notes generated from PR titles.

## 1. Branch

Work on a branch from an up-to-date `main` (`git fetch origin main && git switch -c <topic> origin/main`). Direct pushes to `main` are rejected.

## 2. Choose the bump

Use `$ARGUMENTS` if given, otherwise pick from the change:

| Change | Bump |
|---|---|
| Bug fix, refactor, docs, CI, dev tooling, dependency update | `patch` |
| New feature, setting, menu item, UI text, platform behavior | `minor` |
| Breaking: config format without migration, renamed release assets or `productName`, dropped platform | `major` |

Pre-release: `npm version prerelease --preid beta --no-git-tag-version` publishes a GitHub pre-release, which the in-app updater ignores.

## 3. Apply it

```bash
npm version <patch|minor|major> --no-git-tag-version
```

This updates `package.json` and `package-lock.json`. Never create or push tags: the release job does it. If another PR was merged meanwhile, update the branch from `main` and bump again above the version on `main`.

## 4. Check

```bash
npm test
git fetch origin main && node scripts/check-version.mjs origin/main
```

Depending on what changed:

- User-visible text: follow the `add-ui-text` skill (the i18n tests enforce key and placeholder parity).
- Visible UI change: run the `ui-screenshot` skill; refresh `docs/screenshot*.png` if the main screen changed.
- `src/updater.js`, `src/update-core.js`, `build.*.artifactName` or `build.yml`: run the `test-update-flow` skill. Renamed assets must stay matched by `pickAsset()`.
- New IPC, file access or window option: re-read the security model in `AGENTS.md`.
- Then ask the `code-reviewer` agent to review the branch and fix what it reports.

## 5. Docs

Update the README when behavior changes (How it works, Shortcuts, Structure, Downloads, Updates, Releasing) and `AGENTS.md` when architecture, conventions or contracts change.

## 6. Commit and PR, in English

- Commit subject in the imperative mood, at most 72 characters; body explains why; end with the attribution lines required by the session, if any.
- PR title: one user-facing line, it becomes the release note (`Add Check for Updates menu`, not `updater.js changes`).
- PR body:

```markdown
## Summary
What changes for users, in one or two sentences.

## Changes
- …

## Testing
- `npm test`, version check, manual checks (platforms, languages)

## Not verified
- What could not be tested here (e.g. real install on Windows)
```

Report the PR link, the new version and anything left unverified.
