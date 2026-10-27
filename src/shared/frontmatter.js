/* Parseur minimal du frontmatter YAML des SKILL.md (clés de premier niveau).
 * UMD : require() côté main, <script> côté renderer (window.Frontmatter). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Frontmatter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FM_RE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
  const KEY_RE = /^([A-Za-z0-9_.-]+):(?:\s+(.*)|\s*)$/;

  function unquote(v) {
    if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
      try { return JSON.parse(v); } catch { return v.slice(1, -1); }
    }
    if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") return v.slice(1, -1).replace(/''/g, "'");
    return v;
  }

  function parse(text) {
    const m = FM_RE.exec(text || '');
    if (!m) return { data: {}, body: text || '' };

    const data = {};
    const lines = m[1].split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const kv = KEY_RE.exec(lines[i]);
      if (!kv) continue;
      const key = kv[1];
      const val = (kv[2] || '').trim();

      // Lignes indentées qui suivent (continuation, bloc, mapping imbriqué)
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || (lines[i + 1].trim() === '' && /^\s+\S/.test(lines[i + 2] || '')))) {
        block.push(lines[++i]);
      }

      if (/^[>|][+-]?\d*$/.test(val)) {
        const trimmed = block.map((l) => l.trim());
        data[key] = (val[0] === '>' ? trimmed.join(' ').replace(/\s+/g, ' ') : trimmed.join('\n')).trim();
      } else if (val === '') {
        const nested = block.some((l) => /^\s*(-\s|[\w.-]+:)/.test(l));
        if (nested) {
          const indent = Math.min(...block.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
          data[key] = block.map((l) => l.slice(indent)).join('\n');
        } else {
          data[key] = block.map((l) => l.trim()).join(' ').trim();
        }
      } else {
        data[key] = unquote([val, ...block.map((l) => l.trim())].join(' ').trim());
      }
    }
    return { data, body: text.slice(m[0].length) };
  }

  return { parse };
});
