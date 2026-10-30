import { test } from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};
globalThis.location = { protocol: 'https:', host: 'preview.example.test' };

const { api, setToken } = await import('../src/lib/api.js');
const { RealtimeClient } = await import('../src/lib/ws.js');

test('API requests authenticate without sending an empty JSON body on DELETE', async () => {
  setToken('test-token');
  let request;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await api.del('/api/projects/project/members/user');
    assert.equal(request.options.method, 'DELETE');
    assert.equal(request.options.headers.Authorization, 'Bearer test-token');
    assert.equal(request.options.headers['Content-Type'], undefined);
    assert.equal(request.options.body, undefined);
    await api.post('/api/tasks/123/done', {});
    assert.equal(request.options.headers['Content-Type'], 'application/json');
    assert.equal(request.options.body, '{}');
  } finally { globalThis.fetch = originalFetch; }
});

test('project upload sends its scope before the file', async () => {
  setToken('test-token');
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ file: {} }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await api.upload(new Blob(['example'], { type: 'text/plain' }), 'private-project');
    assert.equal(request.options.headers.Authorization, 'Bearer test-token');
    assert.deepEqual([...request.options.body.keys()], ['projectId', 'file']);
    assert.equal(request.options.body.get('projectId'), 'private-project');
  } finally { globalThis.fetch = originalFetch; }
});

test('downloads attach authentication and save the response under its supplied name', async () => {
  setToken('test-token');
  const original = { fetch: globalThis.fetch, document: globalThis.document, create: URL.createObjectURL,
    revoke: URL.revokeObjectURL, timeout: globalThis.setTimeout };
  let request, clicked = false, revoked = false, link;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response('private content', { headers: { 'Content-Type': 'text/plain' } });
  };
  globalThis.document = {
    createElement: () => (link = { click: () => { clicked = true; }, remove: () => {} }),
    body: { appendChild: () => {} }
  };
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = url => { revoked = url === 'blob:test'; };
  globalThis.setTimeout = callback => { callback(); return 0; };
  try {
    await api.download('file-id', 'private.txt');
    assert.equal(request.url, '/api/files/file-id/download');
    assert.equal(request.options.headers.Authorization, 'Bearer test-token');
    assert.equal(link.download, 'private.txt');
    assert.ok(clicked && revoked);
  } finally {
    globalThis.fetch = original.fetch; globalThis.document = original.document;
    URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke;
    globalThis.setTimeout = original.timeout;
  }
});

test('realtime subscriptions and queued actions wait for authentication', () => {
  setToken('test-token');
  const originalWebSocket = globalThis.WebSocket;
  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; }
    open() { this.readyState = 1; this.onopen(); }
    send(data) { this.sent.push(JSON.parse(data)); }
    receive(data) { this.onmessage({ data: JSON.stringify(data) }); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  }
  globalThis.WebSocket = FakeWebSocket;
  try {
    const client = new RealtimeClient();
    client.connect();
    const socket = client.ws;
    assert.equal(socket.url, 'wss://preview.example.test/ws');
    client.subscribe('project:private');
    client.sendChat('project:private', 'hello');
    socket.open();
    assert.deepEqual(socket.sent, [{ type: 'auth', token: 'test-token' }]);
    socket.receive({ type: 'auth:ok' });
    assert.deepEqual(socket.sent.slice(1), [
      { type: 'subscribe', channel: 'project:private' },
      { type: 'chat:send', channel: 'project:private', text: 'hello' }
    ]);
    client.close();
    assert.equal(client.reconnectTimer, null);
    assert.equal(client.subscribed.size, 0);
  } finally { globalThis.WebSocket = originalWebSocket; }
});
