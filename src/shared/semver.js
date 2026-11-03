'use strict';
/* Minimal semver helpers (no dependency), used by the updater and scripts/check-version.mjs. */

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** { core: [major, minor, patch], pre: [...] }, or null if invalid. Accepts a "v" prefix. */
function parse(version) {
  const m = SEMVER.exec(String(version).trim());
  return m ? { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] } : null;
}

/** Semver precedence (spec §11): < 0 if a < b, 0 if equal, > 0 if a > b. */
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

/** true if `candidate` is strictly newer than `current` (false if either is invalid). */
function isNewer(candidate, current) {
  const a = parse(candidate);
  const b = parse(current);
  return Boolean(a && b && compare(a, b) > 0);
}

module.exports = { parse, compare, isNewer };
