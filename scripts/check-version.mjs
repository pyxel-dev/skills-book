#!/usr/bin/env node
// Checks that a PR to main bumps the version in package.json (= the release version).
// Usage: node scripts/check-version.mjs [base-ref]   (default: origin/main)
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import semver from '../src/shared/semver.js';

const { compare } = semver;
// package.json version: strict, no "v" prefix.
const parse = (version) => (/^\d/.test(String(version)) ? semver.parse(version) : null);

const baseRef = process.argv[2] || 'origin/main';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const errors = [];
const pkg = readJson('package.json');
const lock = readJson('package-lock.json');
const head = pkg.version;

let base;
try {
  base = JSON.parse(git('show', `${baseRef}:package.json`)).version;
} catch (e) {
  errors.push(`Cannot read package.json on ${baseRef}: ${e.stderr?.trim() || e.message}`);
}

const h = parse(head);
if (!h) errors.push(`Version "${head}" is not valid semver (expected MAJOR.MINOR.PATCH).`);

if (h && base !== undefined) {
  const b = parse(base);
  if (b && compare(h, b) <= 0) {
    errors.push(`Version must be greater than ${base} (on ${baseRef}), got ${head}. Run \`npm version patch|minor|major --no-git-tag-version\`.`);
  }
}

const lockVersions = [lock.version, lock.packages?.['']?.version];
if (lockVersions.some((v) => v !== head)) {
  errors.push(`package-lock.json is out of sync (${lockVersions.join(' / ')}). Run \`npm install\` or bump with \`npm version\`.`);
}

const tag = `v${head}`;
if (h && git('tag', '--list', tag)) errors.push(`Tag ${tag} already exists: this version has already been released.`);

const summary = process.env.GITHUB_STEP_SUMMARY;
const report = (text) => { if (summary) appendFileSync(summary, `${text}\n`); };

if (errors.length) {
  for (const msg of errors) console.log(`::error file=package.json,title=Version bump::${msg}`);
  report(`### ❌ Version bump\n\n${errors.map((m) => `- ${m}`).join('\n')}`);
  process.exit(1);
}

console.log(`Version bump OK: ${base} → ${head} (release ${tag} on merge)`);
report(`### ✅ Version bump\n\n\`${base}\` → \`${head}\`: merging publishes release \`${tag}\`.`);
