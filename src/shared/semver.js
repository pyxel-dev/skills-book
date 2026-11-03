'use strict';
/* Versions semver minimales (sans dépendance) : utilisées par l'updater et scripts/check-version.mjs. */

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** { core: [maj, min, patch], pre: [...] } ou null si invalide. Accepte un préfixe "v". */
function parse(version) {
  const m = SEMVER.exec(String(version).trim());
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

/** true si `candidate` est strictement plus récente que `current` (false si l'une est invalide). */
function isNewer(candidate, current) {
  const a = parse(candidate);
  const b = parse(current);
  return Boolean(a && b && compare(a, b) > 0);
}

module.exports = { parse, compare, isNewer };
