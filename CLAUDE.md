@AGENTS.md

## Claude Code

Project skills (`.claude/skills/`), invoked automatically when relevant or with `/name`:

- `/prepare-pr`: version bump, checks, docs and an English PR for a finished change
- `/add-ui-text`: add or change user-visible text in English and French
- `/test-update-flow`: exercise the update check against a mock release feed
- `/ui-screenshot`: capture the window with demo data (light / dark), refresh README screenshots

Agent (`.claude/agents/`): `code-reviewer` reviews the current branch against `main` with the rules above. Run it before opening a PR.
