#!/usr/bin/env node
// Vérifie qu'une PR vers main augmente la version de package.json (= version de la release).
// Usage : node scripts/check-version.mjs [base-ref]   (défaut : origin/main)
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const baseRef = process.argv[2] || 'origin/main';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(version) {
  const m = SEMVER.exec(String(version));
  return m ? { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] } : null;
}

/** Ordre semver (spec §11) : < 0 si a < b, 0 si égal, > 0 si a > b. */
function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length; // 1.0.0 > 1.0.0-beta
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) { if (+x !== +y) return +x - +y; }
    else if (nx !== ny) return nx ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

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
