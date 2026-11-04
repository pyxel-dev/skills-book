'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extract, matchEnding, diffLines, compact, removesMost } = require('../src/shared/proposal');

const summary = (ops) => ops.map((op) => `${op.type}:${op.text}`);

test('extract: reply without a proposal', () => {
  assert.deepEqual(extract(' Just advice. '), { status: 'none', before: 'Just advice.', proposal: '', after: '' });
});

test('extract: complete proposal with text around it', () => {
  const reply = 'Here it is.\n<proposed_file>\nline 1\nline 2\n</proposed_file>\nDone.';
  assert.deepEqual(extract(reply), { status: 'complete', before: 'Here it is.', proposal: 'line 1\nline 2', after: 'Done.' });
});

test('extract: a file that mentions the tags stays intact', () => {
  const reply = '<proposed_file>\nUse <proposed_file> and </proposed_file> here\n</proposed_file>';
  assert.equal(extract(reply).proposal, 'Use <proposed_file> and </proposed_file> here');
});

test('extract: a tag counts only alone on its line', () => {
  const reply = 'I will use a <proposed_file> block.\n<proposed_file>\nNEW\n</proposed_file>';
  assert.deepEqual(extract(reply), { status: 'complete', before: 'I will use a <proposed_file> block.', proposal: 'NEW', after: '' });
});

test('extract: a plain answer mentioning the tag is not a proposal', () => {
  const reply = 'Use a <proposed_file> block here, then continue.';
  assert.deepEqual(extract(reply), { status: 'none', before: reply, proposal: '', after: '' });
});

test('extract: a closing tag alone in the file stays intact', () => {
  assert.equal(extract('<proposed_file>\nA\n</proposed_file>\nB\n</proposed_file>').proposal, 'A\n</proposed_file>\nB');
});

test('extract: a closing tag at the end of the last line still closes the block', () => {
  assert.deepEqual(extract('<proposed_file>\nA\nB</proposed_file>'), { status: 'complete', before: '', proposal: 'A\nB', after: '' });
});

test('extract: a reply cut off before the closing tag is unclosed', () => {
  assert.deepEqual(extract('Intro\n<proposed_file>\npartial'), { status: 'unclosed', before: 'Intro', proposal: '', after: '' });
});

test('extract: CRLF is converted to LF', () => {
  assert.equal(extract('<proposed_file>\r\na\r\nb\r\n</proposed_file>').proposal, 'a\nb');
});

test('matchEnding restores the final newline of the base', () => {
  assert.equal(matchEnding('a', 'b\n'), 'a\n');
  assert.equal(matchEnding('a\n', 'b\n'), 'a\n');
  assert.equal(matchEnding('a', 'b'), 'a');
});

test('diffLines: identical text has only equal lines', () => {
  assert.deepEqual(summary(diffLines('a\nb', 'a\nb')), ['equal:a', 'equal:b']);
});

test('diffLines: replaced line', () => {
  assert.deepEqual(summary(diffLines('a\nb\nc', 'a\nB\nc')), ['equal:a', 'remove:b', 'add:B', 'equal:c']);
});

test('diffLines: added and removed lines', () => {
  assert.deepEqual(summary(diffLines('a\nc', 'a\nb\nc')), ['equal:a', 'add:b', 'equal:c']);
  assert.deepEqual(summary(diffLines('a\nb\nc', 'a\nc')), ['equal:a', 'remove:b', 'equal:c']);
});

test('diffLines: finds a common line between two changes', () => {
  assert.deepEqual(summary(diffLines('x\na\ny', 'z\na\nw')), ['remove:x', 'add:z', 'equal:a', 'remove:y', 'add:w']);
});

test('diffLines: a very large change falls back to one block', () => {
  const lines = (prefix) => Array.from({ length: 3000 }, (_, i) => `${prefix}${i}`).join('\n');
  const ops = diffLines(lines('a'), lines('b'));
  assert.equal(ops.length, 6000);
  assert.ok(ops.slice(0, 3000).every((op) => op.type === 'remove'));
  assert.ok(ops.slice(3000).every((op) => op.type === 'add'));
});

test('compact keeps context around changes and marks the gaps', () => {
  const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n');
  const after = before.replace('5', 'five');
  assert.deepEqual(compact(diffLines(before, after)).map((op) => op.text), ['…', '3', '4', '5', 'five', '6', '7', '…']);
});

test('removesMost flags a shortened file, not a rewrite or a small edit', () => {
  const lines = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}${i}`).join('\n');
  const file = lines('line', 10);
  assert.equal(removesMost(diffLines(file, lines('line', 2))), true);
  assert.equal(removesMost(diffLines(file, lines('line', 5))), false);
  assert.equal(removesMost(diffLines(file, file.replace('line5', 'changed'))), false);
  assert.equal(removesMost(diffLines(file, lines('new', 10))), false);
});
