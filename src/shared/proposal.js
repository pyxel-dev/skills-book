/* Proposal extraction and line diff (UMD: require() or window.Proposal). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Proposal = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OPEN = '<proposed_file>';
  const CLOSE = '</proposed_file>';
  // Above this LCS table size, a change is shown as one block so that the window cannot freeze.
  const MAX_CELLS = 4000000;

  /** First opening tag and last closing tag, so that a file mentioning the tags stays intact. */
  function extract(reply) {
    const start = reply.indexOf(OPEN);
    if (start === -1) return { status: 'none', before: reply.trim(), proposal: '', after: '' };
    const before = reply.slice(0, start).trim();
    const body = start + OPEN.length;
    const end = reply.lastIndexOf(CLOSE);
    if (end < body) return { status: 'unclosed', before, proposal: '', after: '' };
    const proposal = reply.slice(body, end).replace(/\r\n/g, '\n').replace(/^\n/, '').replace(/\n$/, '');
    return { status: 'complete', before, proposal, after: reply.slice(end + CLOSE.length).trim() };
  }

  /** The tag format loses the file's final newline: without this, every proposal would change it. */
  const matchEnding = (text, base) => (base.endsWith('\n') && !text.endsWith('\n') ? `${text}\n` : text);

  const lineOps = (type, lines) => lines.map((text) => ({ type, text }));

  function diffMiddle(a, b) {
    if (!a.length || !b.length || a.length * b.length > MAX_CELLS) {
      return [...lineOps('remove', a), ...lineOps('add', b)];
    }
    // table[i * width + j] = length of the longest common subsequence of a[i:] and b[j:]
    const width = b.length + 1;
    const table = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        table[i * width + j] = a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    const ops = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        ops.push({ type: 'equal', text: a[i] });
        i++;
        j++;
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        ops.push({ type: 'remove', text: a[i++] });
      } else {
        ops.push({ type: 'add', text: b[j++] });
      }
    }
    return [...ops, ...lineOps('remove', a.slice(i)), ...lineOps('add', b.slice(j))];
  }

  function diffLines(before, after) {
    const a = before.split('\n');
    const b = after.split('\n');
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA--;
      endB--;
    }
    return [
      ...lineOps('equal', a.slice(0, start)),
      ...diffMiddle(a.slice(start, endA), b.slice(start, endB)),
      ...lineOps('equal', a.slice(endA)),
    ];
  }

  function compact(ops, context = 2) {
    const gap = { type: 'gap', text: '…' };
    const out = [];
    let skipped = false;
    ops.forEach((op, i) => {
      const near = ops.slice(Math.max(0, i - context), i + context + 1).some((o) => o.type !== 'equal');
      if (!near) {
        skipped = true;
        return;
      }
      if (skipped) out.push(gap);
      skipped = false;
      out.push(op);
    });
    if (skipped) out.push(gap);
    return out;
  }

  return { extract, matchEnding, diffLines, compact };
});
