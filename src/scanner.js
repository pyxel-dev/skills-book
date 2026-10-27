'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { parse } = require('./shared/frontmatter');

const MAX_DEPTH = 9;
const IS_WIN = process.platform === 'win32';

/** Dossiers de config reconnus → les skills/agents dessous sont globaux (si dans $HOME) ou locaux (projet). */
const CONFIG_DIRS = new Set(['.claude', '.codex', '.agents', '.cursor', '.gemini']);

const IGNORED = new Set([
  'node_modules', '.git', '.svn', '.hg', '.next', '.nuxt', '.angular', '.turbo', '.cache',
  '.venv', 'venv', '__pycache__', 'dist', 'build', 'out', 'target', 'coverage',
  'Pods', 'DerivedData', 'Library', 'AppData', '.Trash', '$RECYCLE.BIN',
]);
/** Contenu volumineux ou inactif de ~/.claude. */
const IGNORED_IN_HOME_CLAUDE = new Set(['projects', 'file-history', 'todos', 'shell-snapshots', 'statsig', 'debug', 'session-env', 'telemetry', 'ide', 'local']);
/** ~/.claude/plugins : marketplaces = catalogue (non chargé), data = état des plugins, .trash = supprimés. */
const IGNORED_IN_PLUGINS = new Set(['marketplaces', 'data', '.trash']);

function defaultRoots(home) {
  return [
    path.join(home, '.claude', 'skills'),
    path.join(home, '.claude', 'agents'),
    path.join(home, '.claude', 'plugins'),
    path.join(home, '.agents', 'skills'),
    path.join(home, '.codex', 'skills'),
  ];
}

const norm = (p) => (IS_WIN ? p.toLowerCase() : p);

async function isDir(p) {
  try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
}

async function readJson(p) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}

/** Type d'une entrée en suivant les liens symboliques. */
async function kind(full, dirent) {
  if (!dirent.isSymbolicLink()) return dirent.isDirectory() ? 'dir' : dirent.isFile() ? 'file' : null;
  try {
    const st = await fs.stat(full);
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null;
  } catch { return null; }
}

/** Portée d'un fichier selon le dernier dossier de config de son chemin. */
function classify(file, home) {
  const segs = file.split(path.sep);
  for (let i = segs.length - 2; i >= 0; i--) {
    if (!CONFIG_DIRS.has(segs[i])) continue;
    const base = segs.slice(0, i).join(path.sep) || path.sep;
    const config = { name: segs[i], path: segs.slice(0, i + 1).join(path.sep) };
    if (norm(base) === norm(home)) return { scope: 'global', config, project: null };
    return { scope: 'local', config, project: { name: path.basename(base), path: base } };
  }
  return { scope: 'other', config: null, project: null };
}

/**
 * Parcourt les racines et retourne skills (dossier contenant SKILL.md) et agents
 * (.md avec frontmatter dans un dossier agents/ de .claude ou d'un plugin).
 */
async function scanSkills(roots, home) {
  const homeClaude = norm(path.join(home, '.claude'));
  const homePlugins = norm(path.join(home, '.claude', 'plugins'));
  const visited = new Set();
  const found = new Map();

  async function add(file, item) {
    let real, raw;
    try { [real, raw] = await Promise.all([fs.realpath(file), fs.readFile(file, 'utf8')]); } catch { return; }
    const { data } = parse(raw);
    if (item.kind === 'agent' && !data.name && !data.description) return;

    const dir = path.dirname(file);
    const fallback = item.kind === 'skill' ? path.basename(dir) : path.basename(file, path.extname(file));
    const entry = {
      id: real,
      path: file,
      dir,
      name: String(data.name || fallback),
      description: String(data.description || ''),
      ...item,
      ...classify(file, home),
    };
    // Doublons via liens symboliques : on garde le chemin non lié.
    if (!found.has(real) || file === real) found.set(real, entry);
  }

  /** Contexte d'un dossier : plugin parent éventuel et mode "agents". */
  async function pluginFor(dir, names, parentPlugin) {
    const n = norm(dir);
    const rel = n.startsWith(homePlugins + path.sep) ? path.relative(homePlugins, dir).split(path.sep) : null;

    if (names.includes('.claude-plugin')) {
      const manifest = await readJson(path.join(dir, '.claude-plugin', 'plugin.json'));
      const fromCache = rel && rel[0] === 'cache' && rel.length === 4 ? rel[1] : null;
      return {
        name: manifest?.displayName || manifest?.name || (rel && rel[0] === 'cache' ? rel[2] : path.basename(dir)),
        marketplace: fromCache || (rel && rel[0] === 'synced' ? 'claude.ai' : null),
        path: dir,
      };
    }
    // Manifest optionnel : cache/<marketplace>/<plugin>/<version>/ ou synced/<plugin>/
    if (rel && rel[0] === 'cache' && rel.length === 4) return { name: rel[2], marketplace: rel[1], path: dir };
    if (rel && rel[0] === 'synced' && rel.length === 2) return { name: rel[1], marketplace: 'claude.ai', path: dir };
    return parentPlugin;
  }

  async function walk(dir, ctx, depth) {
    if (depth > MAX_DEPTH) return;
    let real;
    try { real = await fs.realpath(dir); } catch { return; }
    if (visited.has(real)) return;
    visited.add(real);

    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    const names = entries.map((e) => e.name);
    if (names.includes('.orphaned_at')) return; // ancienne version de plugin en attente de suppression

    const plugin = await pluginFor(dir, names, ctx.plugin);
    const nd = norm(dir);

    if (!ctx.agents) {
      const skillEntry = entries.find((e) => e.name.toLowerCase() === 'skill.md');
      if (skillEntry && (await kind(path.join(dir, skillEntry.name), skillEntry)) === 'file') {
        await add(path.join(dir, skillEntry.name), { kind: 'skill', root: ctx.root, plugin });
        return;
      }
    }

    await Promise.all(entries.map(async (e) => {
      if (IGNORED.has(e.name)) return;
      if (nd === homeClaude && IGNORED_IN_HOME_CLAUDE.has(e.name)) return;
      if (nd === homePlugins && IGNORED_IN_PLUGINS.has(e.name)) return;

      const full = path.join(dir, e.name);
      const k = await kind(full, e);
      if (k === 'file') {
        if (ctx.agents && /\.md$/i.test(e.name)) await add(full, { kind: 'agent', root: ctx.root, plugin });
      } else if (k === 'dir') {
        const agents = ctx.agents || (e.name === 'agents' && (path.basename(dir) === '.claude' || names.includes('.claude-plugin') || plugin?.path === dir));
        await walk(full, { ...ctx, plugin, agents }, depth + 1);
      }
    }));
  }

  for (const root of roots) {
    const parent = path.dirname(root);
    const agents = path.basename(root) === 'agents'
      && (path.basename(parent) === '.claude' || (await isDir(path.join(parent, '.claude-plugin'))));
    await walk(root, { root, plugin: null, agents }, 0);
  }

  return [...found.values()];
}

module.exports = { scanSkills, defaultRoots, isDir };
