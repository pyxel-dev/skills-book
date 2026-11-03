#!/usr/bin/env node
// Creates neutral demo data for screenshots: a fake home (global skills, a plugin, agents),
// a project with local skills/agents, and an isolated userData folder with a config pointing at them.
// Usage: node demo-home.mjs [dir]   (default: <tmp>/skills-book-demo) — prints the paths as JSON.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function createDemo(dir = path.join(tmpdir(), 'skills-book-demo')) {
  const home = path.join(dir, 'home');
  const userData = path.join(dir, 'user-data');
  rmSync(dir, { recursive: true, force: true });

  const write = (rel, text) => {
    const file = path.join(home, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const md = (fm, body = '') => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body}`;

  // Global skills and agents
  write('.claude/skills/commit-message/SKILL.md', md({ name: 'commit-message', description: 'Writes Conventional Commits messages from the staged diff.' }, '# Commit message\n'));
  write('.claude/skills/code-review/SKILL.md', md({ name: 'code-review', description: 'Reviews a diff for bugs, security issues and style before opening a pull request.' }, '# Code review\n'));
  write('.claude/skills/pdf-tools/SKILL.md', md({ name: 'pdf-tools', description: 'Extract text and tables from PDFs, merge and split files. Use whenever a PDF is mentioned.' }, '# PDF tools\n'));
  write('.claude/agents/code-reviewer.md', md({ name: 'code-reviewer', description: 'Reviews code for quality and best practices.', tools: 'Read, Glob, Grep', model: 'sonnet' }, 'You are a senior code reviewer.\n'));
  write('.claude/agents/security-auditor.md', md({ name: 'security-auditor', description: 'Audits changes for security vulnerabilities.', model: 'opus' }, 'You audit code for security issues.\n'));

  // Installed plugin (marketplace cache layout)
  const plugin = '.claude/plugins/cache/acme-tools/design/1.2.0';
  write(`${plugin}/.claude-plugin/plugin.json`, JSON.stringify({ name: 'design', version: '1.2.0' }));
  write(`${plugin}/skills/ux-copy/SKILL.md`, md({ name: 'design:ux-copy', description: 'Write or review UX copy — microcopy, error messages, empty states and CTAs.' }, '# UX copy\n'));
  write(`${plugin}/skills/accessibility-review/SKILL.md`, md({ name: 'design:accessibility-review', description: 'Run a WCAG 2.1 AA audit on a page: contrast, keyboard navigation, screen readers.' }, '# Accessibility review\n'));
  write(`${plugin}/agents/design-reviewer.md`, md({ name: 'design-reviewer', description: 'Critiques mockups for hierarchy, consistency and usability.' }, 'You review designs.\n'));

  // Local project
  write('dev/my-app/.claude/skills/deploy/SKILL.md', md(
    { name: 'deploy', description: 'Build and deploy my-app to production with Docker. Use when asked to ship, release or deploy.', 'allowed-tools': 'Bash, Read' },
    '\n# Deploy\n\nShip the current `main` branch to production.\n\n## Steps\n\n1. Run the test suite: `npm test`\n2. Build the image: `docker build -t my-app .`\n3. Push the image and restart the service\n4. Check that `/health` returns **200**\n\n## Rollback\n\n> If the health check fails, redeploy the previous tag.\n',
  ));
  write('dev/my-app/.claude/skills/release-notes/SKILL.md', md({ name: 'release-notes', description: 'Drafts release notes from the merged pull requests since the last tag.' }, '# Release notes\n'));
  write('dev/my-app/.claude/agents/test-writer.md', md({ name: 'test-writer', description: 'Writes and runs Vitest unit tests for changed files.' }, 'You write tests.\n'));

  mkdirSync(userData, { recursive: true });
  const roots = ['.claude/skills', '.claude/agents', '.claude/plugins', '.agents/skills', '.codex/skills', 'dev'].map((r) => path.join(home, r));
  writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ version: 2, lang: 'en', roots }, null, 2));

  return { dir, home, userData };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('demo-home.mjs')) {
  console.log(JSON.stringify(createDemo(process.argv[2] && path.resolve(process.argv[2])), null, 2));
}
