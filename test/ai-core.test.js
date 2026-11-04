'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/ai-core');

function fakeFetch(status, body) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { fetch, calls };
}
const hasCode = (code, detail) => (e) => {
  assert.ok(e instanceof core.AiError);
  assert.equal(e.code, code);
  if (detail !== undefined) assert.equal(e.detail, detail);
  return true;
};
const chatArgs = { key: 'secret', localUrl: 'http://localhost:11434/v1', model: 'm', document: 'DOC', messages: [{ role: 'user', content: 'hi' }] };

test('validateLocalUrl accepts https anywhere and http on loopback', () => {
  assert.equal(core.validateLocalUrl('http://localhost:11434/v1/'), 'http://localhost:11434/v1');
  assert.equal(core.validateLocalUrl(' http://127.0.0.1:1234/v1 '), 'http://127.0.0.1:1234/v1');
  assert.equal(core.validateLocalUrl('http://[::1]:1234/v1'), 'http://[::1]:1234/v1');
  assert.equal(core.validateLocalUrl('https://llm.example.com/v1'), 'https://llm.example.com/v1');
});

test('validateLocalUrl rejects other URLs', () => {
  for (const url of ['http://192.168.1.2:11434/v1', 'http://localhost.evil.com/v1', 'ftp://localhost/v1', 'https://user:pass@example.com/v1', 'nope', undefined]) {
    assert.throws(() => core.validateLocalUrl(url), hasCode('invalid_url'), String(url));
  }
});

test('normalizeConfig fills in defaults', () => {
  assert.deepEqual(core.normalizeConfig(), {
    provider: 'anthropic',
    models: { anthropic: '', openai: '', local: '' },
    localUrl: 'http://localhost:11434/v1',
    keys: {},
  });
});

test('normalizeConfig keeps valid values and drops invalid ones', () => {
  const ai = core.normalizeConfig({
    provider: 'openai',
    models: { openai: 'gpt', local: 42 },
    localUrl: 'http://localhost:1234/v1',
    keys: { openai: 'abc', local: 'def', other: 'x' },
  });
  assert.deepEqual(ai, {
    provider: 'openai',
    models: { anthropic: '', openai: 'gpt', local: '' },
    localUrl: 'http://localhost:1234/v1',
    keys: { openai: 'abc', local: 'def' },
  });
  assert.equal(core.normalizeConfig({ provider: 'other' }).provider, 'anthropic');
});

test('normalizeConfig drops the local key when the stored URL is invalid', () => {
  const ai = core.normalizeConfig({ localUrl: 'http://evil.example.com/v1', keys: { local: 'def' } });
  assert.equal(ai.localUrl, 'http://localhost:11434/v1');
  assert.deepEqual(ai.keys, {});
});

test('validMessages checks roles and content', () => {
  assert.equal(core.validMessages([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]), true);
  assert.equal(core.validMessages([{ role: 'system', content: 'a' }]), false);
  assert.equal(core.validMessages([{ role: 'user', content: 1 }]), false);
  assert.equal(core.validMessages('nope'), false);
});

test('chat: Anthropic request and reply', async () => {
  const { fetch, calls } = fakeFetch(200, { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Hel' }, { type: 'text', text: 'lo' }] });
  const reply = await core.chat({ ...chatArgs, fetch, provider: 'anthropic' });
  assert.equal(reply, 'Hello');
  const { url, init } = calls[0];
  const body = JSON.parse(init.body);
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers['x-api-key'], 'secret');
  assert.equal(init.headers['anthropic-version'], '2023-06-01');
  assert.equal(body.model, 'm');
  assert.equal(body.max_tokens, 8192);
  assert.match(body.system, /<document>\nDOC\n<\/document>/);
  assert.match(body.system, /every line of the file/);
  assert.deepEqual(body.messages, chatArgs.messages);
});

test('chat: OpenAI request and reply', async () => {
  const { fetch, calls } = fakeFetch(200, { choices: [{ message: { content: 'Hello' } }] });
  const reply = await core.chat({ ...chatArgs, fetch, provider: 'openai' });
  assert.equal(reply, 'Hello');
  const { url, init } = calls[0];
  const body = JSON.parse(init.body);
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(init.headers.Authorization, 'Bearer secret');
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.stream, false);
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[0].content, /<document>\nDOC\n<\/document>/);
  assert.deepEqual(body.messages.slice(1), chatArgs.messages);
});

test('chat: local server without a key sends no Authorization header', async () => {
  const { fetch, calls } = fakeFetch(200, { choices: [{ message: { content: 'Hello' } }] });
  await core.chat({ ...chatArgs, fetch, provider: 'local', key: '' });
  assert.equal(calls[0].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test('errors: refused key', async () => {
  const { fetch } = fakeFetch(401, { error: { message: 'nope' } });
  await assert.rejects(core.chat({ ...chatArgs, fetch, provider: 'openai' }), hasCode('auth'));
});

test('errors: a 403 keeps the provider reason instead of blaming the key', async () => {
  const { fetch } = fakeFetch(403, { error: { message: 'No access to this model' } });
  await assert.rejects(core.chat({ ...chatArgs, fetch, provider: 'openai' }), hasCode('failed', 'No access to this model'));
});

test('errors: provider message is kept, capped and redacted', async () => {
  const long = fakeFetch(500, { error: { message: 'x'.repeat(400) } });
  await assert.rejects(core.chat({ ...chatArgs, fetch: long.fetch, provider: 'openai' }), hasCode('failed', 'x'.repeat(300)));
  const redacted = fakeFetch(429, { error: { message: 'bad key secret here' } });
  await assert.rejects(core.chat({ ...chatArgs, fetch: redacted.fetch, provider: 'openai' }), hasCode('failed', 'bad key *** here'));
  const stringError = fakeFetch(404, { error: 'model not found' });
  await assert.rejects(core.chat({ ...chatArgs, fetch: stringError.fetch, provider: 'local' }), hasCode('failed', 'model not found'));
  const notJson = fakeFetch(502, 'Bad gateway');
  await assert.rejects(core.chat({ ...chatArgs, fetch: notJson.fetch, provider: 'local' }), hasCode('failed', 'Bad gateway'));
  const noMessage = fakeFetch(500, { error: { type: 'x' } });
  await assert.rejects(core.chat({ ...chatArgs, fetch: noMessage.fetch, provider: 'local' }), hasCode('failed', '{"error":{"type":"x"}}'));
});

test('errors: connection failure', async () => {
  const fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(core.chat({ ...chatArgs, fetch, provider: 'local' }), hasCode('unreachable'));
});

test('errors: unexpected reply shapes', async () => {
  const bodies = ['<html>', null, {}, { choices: [{ message: { content: '' } }] }, { choices: [{ message: { content: [{ type: 'text', text: 'x' }] } }] }];
  for (const body of bodies) {
    const { fetch } = fakeFetch(200, body);
    await assert.rejects(core.chat({ ...chatArgs, fetch, provider: 'local' }), hasCode('bad_reply'), JSON.stringify(body));
  }
  const anthropic = fakeFetch(200, { content: 'nope' });
  await assert.rejects(core.chat({ ...chatArgs, fetch: anthropic.fetch, provider: 'anthropic' }), hasCode('bad_reply'));
});

test('errors: an error returned with HTTP 200 is shown', async () => {
  const { fetch } = fakeFetch(200, { error: 'Unexpected endpoint' });
  await assert.rejects(core.chat({ ...chatArgs, fetch, provider: 'local' }), hasCode('failed', 'Unexpected endpoint'));
});

test('listModels: Anthropic and local', async () => {
  const anthropic = fakeFetch(200, { data: [{ id: 'a' }, { id: 'b' }] });
  assert.deepEqual(await core.listModels({ fetch: anthropic.fetch, provider: 'anthropic', key: 'secret' }), ['a', 'b']);
  assert.equal(anthropic.calls[0].url, 'https://api.anthropic.com/v1/models?limit=1000');
  assert.equal(anthropic.calls[0].init.method, 'GET');
  const local = fakeFetch(200, { data: [{ id: 'llama' }] });
  assert.deepEqual(await core.listModels({ fetch: local.fetch, provider: 'local', key: '', localUrl: 'http://localhost:1234/v1' }), ['llama']);
  assert.equal(local.calls[0].url, 'http://localhost:1234/v1/models');
  const odd = fakeFetch(200, { data: 'nope' });
  assert.deepEqual(await core.listModels({ fetch: odd.fetch, provider: 'local', key: '', localUrl: 'http://localhost:1234/v1' }), []);
});
