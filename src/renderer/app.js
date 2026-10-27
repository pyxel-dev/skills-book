'use strict';
(() => {
  const { api, Icons, Frontmatter, EasyMDE, I18n } = window;
  const $ = (id) => document.getElementById(id);

  document.documentElement.classList.add(`platform-${api.platform}`);
  Icons.hydrate();

  let lang = I18n.DEFAULT;
  const t = (key, params) => I18n.t(lang, key, params);
  const revealLabel = () => t(`action.reveal.${['darwin', 'win32'].includes(api.platform) ? api.platform : 'other'}`);
  const SEP = api.platform === 'win32' ? '\\' : '/';

  const els = {
    filter: $('filter'), list: $('list'), count: $('count'),
    roots: $('roots'), rootsList: $('roots-list'),
    head: $('doc-head'), name: $('doc-name'), desc: $('doc-desc'), path: $('doc-path'), origin: $('doc-origin'), dirtyDot: $('dirty-dot'),
    save: $('btn-save'), reveal: $('btn-reveal'), open: $('btn-open'),
    empty: $('empty'), wrap: $('editor-wrap'), toast: $('toast'), resizer: $('resizer'),
    tabs: $('tabs'), scopes: $('scopes'),
  };

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  };

  const state = {
    home: '', roots: [], skills: [], filter: '',
    kind: store.get('kind', 'skill'),
    scope: store.get('scope', 'all'),
    collapsed: new Set(store.get('collapsed', [])),
    current: null, saved: '', mtimeMs: 0, dirty: false, loading: false,
  };

  /* ---------- Utilitaires ---------- */

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const tilde = (p) => (state.home && (p === state.home || p.startsWith(state.home + SEP)) ? '~' + p.slice(state.home.length) : p);
  const errMsg = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  let toastTimer;
  function toast(msg, type = 'info') {
    els.toast.textContent = msg;
    els.toast.dataset.type = type;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), type === 'error' ? 5000 : 1800);
  }

  const SCOPE_ORDER = { global: 0, local: 1, other: 2 };

  /** Groupe d'affichage d'un élément : config globale, plugin, projet, ou dossier libre. */
  function groupOf(s) {
    if (s.plugin) {
      return { key: `p:${s.plugin.path}`, scope: s.scope, icon: 'puzzle', label: s.plugin.name, sub: s.plugin.marketplace || s.project?.name || '', title: s.plugin.path, rank: 1 };
    }
    if (s.scope === 'local') {
      return { key: `c:${s.config.path}`, scope: 'local', icon: 'folder', label: s.project.name, sub: s.config.name, title: s.project.path, rank: 0 };
    }
    if (s.scope === 'global') {
      return { key: `c:${s.config.path}`, scope: 'global', icon: 'globe', label: tilde(s.config.path), sub: '', title: s.config.path, rank: 0 };
    }
    return { key: `o:${s.root}`, scope: 'other', icon: 'box', label: tilde(s.root), sub: '', title: s.root, rank: 0 };
  }

  const pill = (scope) => `<span class="pill pill-${scope}" title="${esc(t(`scope.${scope}.title`))}">${esc(t(`scope.${scope}`))}</span>`;

  /** Chemin affiché en deux parties : tête tronquée, 2 derniers segments toujours visibles. */
  function splitPath(p) {
    const parts = tilde(p).split(/[\\/]/);
    const tail = parts.splice(-2).join(SEP);
    return { head: parts.length ? parts.join(SEP) + SEP : '', tail };
  }

  /* ---------- Éditeur ---------- */

  const TOOLS = [
    ['bold', EasyMDE.toggleBold, 'bold'],
    ['italic', EasyMDE.toggleItalic, 'italic'],
    ['heading', EasyMDE.toggleHeadingSmaller, 'heading'],
    '|',
    ['code', EasyMDE.toggleCodeBlock, 'code'],
    ['quote', EasyMDE.toggleBlockquote, 'quote'],
    ['ul', EasyMDE.toggleUnorderedList, 'ul'],
    ['ol', EasyMDE.toggleOrderedList, 'ol'],
    ['link', EasyMDE.drawLink, 'link'],
    ['table', EasyMDE.drawTable, 'table'],
    '|',
    ['preview', EasyMDE.togglePreview, 'eye', true],
    ['side-by-side', EasyMDE.toggleSideBySide, 'columns', true],
  ];
  // Titres provisoires = clés ; traduits (avec le raccourci ajouté par EasyMDE) dans applyLang().
  const toolbar = TOOLS.map((x) => (x === '|' ? x : {
    name: x[0], action: x[1], title: `tb.${x[0]}`, className: `tb-${x[0]}`, icon: Icons.svg(x[2]), noDisable: Boolean(x[3]),
  }));

  const mde = new EasyMDE({
    element: $('editor'),
    autoDownloadFontAwesome: false,
    spellChecker: false,
    nativeSpellcheck: false,
    minHeight: '0px',
    sideBySideFullscreen: false,
    tabSize: 2,
    unorderedListStyle: '-',
    status: ['lines', 'words', 'cursor'],
    renderingConfig: { codeSyntaxHighlighting: false },
    toolbar,
    previewRender(text) {
      const { data, body } = Frontmatter.parse(text);
      const keys = Object.keys(data);
      const fm = keys.length
        ? `<dl class="fm">${keys.map((k) => `<dt>${esc(k)}</dt><dd>${esc(data[k])}</dd>`).join('')}</dl>`
        : '';
      return fm + mde.markdown(body);
    },
  });

  const cm = mde.codemirror;
  // Suffixe de raccourci ajouté par EasyMDE au title (ex. " (Ctrl-B)"), conservé lors des changements de langue.
  for (const btn of document.querySelectorAll('.editor-toolbar button[title^="tb."]')) {
    const key = btn.title.match(/^tb\.[\w-]+/)[0];
    btn.dataset.i18nKey = key;
    btn.dataset.shortcut = btn.title.slice(key.length);
  }

  function setEditorValue(text) {
    state.loading = true;
    mde.value(text);
    cm.clearHistory();
    cm.setCursor(0, 0);
    cm.scrollTo(0, 0);
    state.loading = false;
  }

  function setDirty(value) {
    if (state.dirty === value) return;
    state.dirty = value;
    els.dirtyDot.hidden = !value;
    els.save.disabled = !value;
    api.setDirty(value);
  }

  const syncHeader = debounce(() => {
    if (!state.current) return;
    const { data } = Frontmatter.parse(mde.value());
    els.name.textContent = data.name || state.current.name;
    els.desc.textContent = data.description ?? state.current.description;
  }, 150);

  // Le mode Markdown de CodeMirror interprète le frontmatter (setext headers…) : on le neutralise visuellement.
  let fmMark = null;
  let fmLines = 0;
  function markFrontmatter() {
    fmMark?.clear();
    fmMark = null;
    for (let i = 0; i < fmLines; i++) cm.removeLineClass(i, 'background', 'cm-fm-line');
    fmLines = 0;

    if (!/^﻿?---\s*$/.test(cm.getLine(0) ?? '')) return;
    const last = Math.min(cm.lineCount() - 1, 200);
    for (let i = 1; i <= last; i++) {
      if (/^---\s*$/.test(cm.getLine(i))) {
        fmMark = cm.markText({ line: 0, ch: 0 }, { line: i, ch: cm.getLine(i).length }, { className: 'cm-fm', inclusiveRight: true });
        fmLines = i + 1;
        for (let l = 0; l < fmLines; l++) cm.addLineClass(l, 'background', 'cm-fm-line');
        return;
      }
    }
  }

  cm.on('change', () => {
    cm.operation(markFrontmatter);
    if (state.loading || !state.current) return;
    setDirty(mde.value() !== state.saved);
    syncHeader();
  });

  /* ---------- Documents ---------- */

  function showDoc(visible) {
    els.head.hidden = !visible;
    els.wrap.hidden = !visible;
    els.empty.hidden = visible;
    if (visible) cm.refresh();
  }

  function renderHeader() {
    const s = state.current;
    els.name.textContent = s.name;
    els.desc.textContent = s.description;
    els.path.textContent = tilde(s.path);
    els.path.title = s.path;
    const g = groupOf(s);
    els.origin.innerHTML = `${pill(s.scope)}<span class="kind">${t(`kind.${s.kind}`)}</span>`
      + `<span class="origin-src" title="${esc(g.title)}">${Icons.svg(g.icon, 13)}${esc(g.label)}${g.sub ? `<span class="muted"> · ${esc(g.sub)}</span>` : ''}</span>`;
  }

  async function open(id) {
    const skill = state.skills.find((s) => s.id === id);
    if (!skill) return;
    let res;
    try { res = await api.read(id); } catch (e) { toast(errMsg(e), 'error'); return; }

    state.current = skill;
    state.saved = res.content;
    state.mtimeMs = res.mtimeMs;
    setEditorValue(res.content);
    setDirty(false);
    renderHeader();
    showDoc(true);
    markActive();
    try { localStorage.setItem('last', id); } catch {}
  }

  async function reloadCurrent() {
    if (!state.current) return;
    const { line, ch } = cm.getCursor();
    const { top } = cm.getScrollInfo();
    const res = await api.read(state.current.id);
    state.saved = res.content;
    state.mtimeMs = res.mtimeMs;
    setEditorValue(res.content);
    cm.setCursor(line, ch);
    cm.scrollTo(0, top);
    setDirty(false);
    syncHeader();
  }

  function closeDoc() {
    state.current = null;
    setEditorValue('');
    setDirty(false);
    showDoc(false);
    markActive();
  }

  let saving = null;
  function save() {
    // Menu natif + raccourci clavier peuvent se déclencher ensemble : une seule écriture à la fois.
    saving ??= doSave().finally(() => { saving = null; });
    return saving;
  }

  async function doSave() {
    if (!state.current || !state.dirty) return 'clean';
    const content = mde.value();
    let res;
    try { res = await api.write(state.current.id, content, state.mtimeMs); } catch (e) { toast(errMsg(e), 'error'); return 'error'; }

    if (res.status === 'saved') {
      state.saved = content;
      state.mtimeMs = res.mtimeMs;
      setDirty(mde.value() !== content);
      const { data } = Frontmatter.parse(content);
      Object.assign(state.current, { name: data.name || state.current.name, description: data.description ?? state.current.description });
      renderList();
      toast(t('toast.saved'));
    } else if (res.status === 'reload') {
      await reloadCurrent();
      toast(t('toast.reloaded'));
    }
    return res.status;
  }

  /** true si on peut quitter le document courant. */
  async function resolveUnsaved() {
    if (!state.dirty) return true;
    const choice = await api.confirmUnsaved(els.name.textContent || state.current.name);
    if (choice === 'cancel') return false;
    if (choice === 'save') return (await save()) === 'saved';
    return true;
  }

  async function select(id) {
    if (state.current?.id === id) return;
    if (await resolveUnsaved()) await open(id);
  }

  /* ---------- Liste ---------- */

  const ofKind = () => state.skills.filter((s) => s.kind === state.kind);

  function filtered() {
    const q = state.filter.trim().toLowerCase();
    return ofKind().filter((s) => (state.scope === 'all' || s.scope === state.scope)
      && (!q || [s.name, s.description, s.path, s.plugin?.name, s.project?.name].join('\n').toLowerCase().includes(q)));
  }

  const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

  function renderChrome() {
    for (const kind of ['skill', 'agent']) $(`n-${kind}`).textContent = state.skills.filter((s) => s.kind === kind).length;
    els.tabs.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.kind === state.kind;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
    });
    const hasOther = ofKind().some((s) => s.scope === 'other');
    els.scopes.querySelector('[data-scope="other"]').hidden = !hasOther;
    if (!hasOther && state.scope === 'other') state.scope = 'all';
    els.scopes.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.scope === state.scope));
  }

  function renderList() {
    renderChrome();
    const all = ofKind();
    const items = filtered();
    els.count.textContent = items.length === all.length
      ? t(`count.${state.kind}`, { n: all.length })
      : `${items.length} / ${all.length}`;

    if (!all.length) {
      els.list.innerHTML = `
        <div class="list-empty">
          <p>${t(state.kind === 'agent' ? 'list.noAgents' : 'list.noSkills')}</p>
          ${state.kind === 'agent' ? `<p class="hint">${t('list.agentsHint', { a: '<code>~/.claude/agents</code>', b: '<code>&lt;project&gt;/.claude/agents</code>' })}</p>` : ''}
          <button class="btn" data-action="roots">${t('list.manageFolders')}</button>
        </div>`;
      return;
    }
    if (!items.length) {
      els.list.innerHTML = `<div class="list-empty"><p>${t('list.noResults')}</p></div>`;
      return;
    }

    const groups = new Map();
    for (const s of items) {
      const g = groupOf(s);
      g.key = `${s.kind}|${g.key}`; // repli mémorisé par onglet
      if (!groups.has(g.key)) groups.set(g.key, { ...g, items: [] });
      groups.get(g.key).items.push(s);
    }
    const sorted = [...groups.values()].sort((a, b) =>
      (SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope]) || (a.rank - b.rank) || coll.compare(a.label, b.label) || coll.compare(a.sub, b.sub));

    const reveal = Icons.svg('folder', 15);
    const revealTitle = esc(revealLabel());
    const chevron = Icons.svg('chevron', 12);
    let html = '';
    for (const g of sorted) {
      const open = !state.collapsed.has(g.key);
      html += `
        <button class="group" data-group="${esc(g.key)}" aria-expanded="${open}" title="${esc(g.title)}">
          <span class="chev">${chevron}</span>
          ${pill(g.scope)}
          <span class="group-label">${Icons.svg(g.icon, 12)}<span>${esc(g.label)}</span></span>
          ${g.sub ? `<span class="group-sub">${esc(g.sub)}</span>` : ''}
          <span class="group-n">${g.items.length}</span>
        </button>`;
      if (!open) continue;
      g.items.sort((a, b) => coll.compare(a.name, b.name) || coll.compare(a.path, b.path));
      for (const s of g.items) {
        const i = state.skills.indexOf(s);
        const { head, tail } = splitPath(s.kind === 'agent' ? s.path : s.dir);
        html += `
          <div class="item${state.current?.id === s.id ? ' active' : ''}" data-i="${i}">
            <button class="item-main" data-i="${i}" title="${esc(s.path)}">
              <span class="item-name">${esc(s.name)}</span>
              ${s.description ? `<span class="item-desc">${esc(s.description)}</span>` : ''}
              <span class="item-path"><span class="head">${esc(head)}</span><span class="tail">${esc(tail)}</span></span>
            </button>
            <button class="icon-btn item-reveal" data-reveal="${i}" title="${revealTitle}" aria-label="${revealTitle}">${reveal}</button>
          </div>`;
      }
    }
    els.list.innerHTML = html;
  }

  function markActive() {
    els.list.querySelectorAll('.item').forEach((el) => {
      el.classList.toggle('active', state.skills[el.dataset.i]?.id === state.current?.id);
    });
  }

  els.list.addEventListener('click', (e) => {
    const revealBtn = e.target.closest('[data-reveal]');
    if (revealBtn) return api.reveal(state.skills[revealBtn.dataset.reveal].id).catch((err) => toast(errMsg(err), 'error'));
    if (e.target.closest('[data-action="roots"]')) return toggleRoots(true);
    const group = e.target.closest('[data-group]');
    if (group) {
      const key = group.dataset.group;
      state.collapsed.has(key) ? state.collapsed.delete(key) : state.collapsed.add(key);
      store.set('collapsed', [...state.collapsed]);
      return renderList();
    }
    const main = e.target.closest('.item-main');
    if (main) select(state.skills[main.dataset.i].id);
  });

  els.list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [...els.list.querySelectorAll('.item-main')];
    const idx = buttons.indexOf(document.activeElement);
    const next = buttons[idx + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest' }); }
  });

  els.tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-kind]');
    if (!tab || tab.dataset.kind === state.kind) return;
    state.kind = tab.dataset.kind;
    store.set('kind', state.kind);
    renderList();
  });

  els.scopes.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-scope]');
    if (!chip) return;
    state.scope = chip.dataset.scope;
    store.set('scope', state.scope);
    renderList();
  });

  els.filter.addEventListener('input', () => { state.filter = els.filter.value; renderList(); });
  els.filter.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); els.list.querySelector('.item-main')?.focus(); }
    if (e.key === 'Escape' && els.filter.value) { els.filter.value = ''; state.filter = ''; renderList(); }
  });

  /* ---------- Scan & dossiers ---------- */

  async function scan() {
    els.list.classList.add('busy');
    try {
      const res = await api.scan();
      Object.assign(state, { home: res.home, roots: res.roots, skills: res.skills });
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      els.list.classList.remove('busy');
    }

    if (state.current) {
      const still = state.skills.find((s) => s.id === state.current.id);
      if (still) { state.current = still; renderHeader(); syncHeader(); }
      else if (!state.dirty) closeDoc();
      else toast(t('toast.gone'), 'error');
    }
    renderList();
    renderRoots();
  }

  function renderRoots() {
    els.rootsList.innerHTML = state.roots.length
      ? state.roots.map((r, i) => `
          <li class="${r.exists ? '' : 'missing'}">
            <span class="root-path" title="${esc(r.path)}">${esc(tilde(r.path))}</span>
            ${r.exists ? '' : `<span class="badge">${t('roots.missing')}</span>`}
            <button class="icon-btn" data-remove="${i}" title="${esc(t('roots.remove'))}">${Icons.svg('x', 14)}</button>
          </li>`).join('')
      : `<li class="muted">${t('roots.empty')}</li>`;
  }

  function toggleRoots(force) {
    els.roots.hidden = !(force ?? els.roots.hidden);
  }

  els.rootsList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    await api.removeRoot(state.roots[btn.dataset.remove].path);
    await scan();
  });

  async function addRoot() {
    if (await api.addRoot()) { await scan(); toggleRoots(true); }
  }

  $('btn-add-root').addEventListener('click', addRoot);
  $('btn-reset-roots').addEventListener('click', async () => { await api.resetRoots(); await scan(); });
  $('btn-roots').addEventListener('click', () => toggleRoots());
  $('btn-roots-close').addEventListener('click', () => toggleRoots(false));
  $('btn-rescan').addEventListener('click', async () => { await scan(); toast(t('toast.scanned')); });

  /* ---------- Actions document ---------- */

  els.save.addEventListener('click', save);
  els.reveal.addEventListener('click', () => state.current && api.reveal(state.current.id));
  els.open.addEventListener('click', () => state.current && api.openExternal(state.current.id).catch((e) => toast(errMsg(e), 'error')));

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });

  api.on('menu:save', save);
  api.on('menu:rescan', scan);
  api.on('menu:add-root', addRoot);
  api.on('menu:find', () => { els.filter.focus(); els.filter.select(); });
  api.on('app:save-then-close', async () => { if ((await save()) === 'saved') api.closeNow(); });

  // Fichier modifié ailleurs pendant que l'app était en arrière-plan.
  window.addEventListener('focus', async () => {
    if (!state.current || state.dirty) return;
    try {
      const { mtimeMs } = await api.stat(state.current.id);
      if (mtimeMs !== state.mtimeMs) { await reloadCurrent(); toast(t('toast.reloaded')); }
    } catch {}
  });

  /* ---------- Redimensionnement de la sidebar ---------- */

  const setSidebar = (w) => document.documentElement.style.setProperty('--sidebar-w', `${Math.round(Math.min(560, Math.max(220, w)))}px`);
  try { const w = Number(localStorage.getItem('sidebar-w')); if (w) setSidebar(w); } catch {}

  els.resizer.addEventListener('pointerdown', (e) => {
    els.resizer.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const move = (ev) => setSidebar(ev.clientX);
    const up = () => {
      els.resizer.removeEventListener('pointermove', move);
      document.body.classList.remove('resizing');
      cm.refresh();
      try { localStorage.setItem('sidebar-w', parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10)); } catch {}
    };
    els.resizer.addEventListener('pointermove', move);
    els.resizer.addEventListener('pointerup', up, { once: true });
  });

  /* ---------- Langue ---------- */

  const langSelect = $('lang');
  langSelect.innerHTML = Object.entries(I18n.LANGS).map(([code, name]) => `<option value="${code}">${name}</option>`).join('');

  function applyLang(next) {
    lang = I18n.normalize(next);
    document.documentElement.lang = lang;
    langSelect.value = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.querySelectorAll('.editor-toolbar button[data-i18n-key]').forEach((btn) => {
      btn.title = t(btn.dataset.i18nKey) + btn.dataset.shortcut;
      btn.setAttribute('aria-label', t(btn.dataset.i18nKey));
    });
    const root = document.documentElement.style;
    root.setProperty('--i18n-lines', JSON.stringify(`${t('status.lines')} `));
    root.setProperty('--i18n-words', JSON.stringify(`${t('status.words')} `));
    els.reveal.title = revealLabel();
    renderList();
    renderRoots();
    if (state.current) renderHeader();
  }

  langSelect.addEventListener('change', async () => applyLang(await api.setLang(langSelect.value)));

  /* ---------- Démarrage ---------- */

  showDoc(false);
  api.getLang().then(applyLang).then(scan).then(() => {
    let last;
    try { last = localStorage.getItem('last'); } catch {}
    if (last && state.skills.some((s) => s.id === last)) open(last);
  });
})();
