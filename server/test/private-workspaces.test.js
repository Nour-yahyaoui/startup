import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import initSqlJs from 'sql.js';

const serverDir = path.resolve(import.meta.dirname, '..');
let tempDir, server, base, output = '';
let owner, member, outsider, manager, viewer, admin, project, task, projectFile;
const sockets = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

before(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'nexa-access-'));
  server = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDir,
    env: { ...process.env, PORT: '0', NEXA_DATA_DIR: path.join(tempDir, 'data'),
      NEXA_UPLOAD_DIR: path.join(tempDir, 'uploads'), NEXA_JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 15000);
    const collect = (chunk) => {
      output += chunk.toString();
      const port = output.match(/Nexa server running on http:\/\/0\.0\.0\.0:(\d+)/);
      if (port) {
        clearTimeout(timer);
        base = `http://127.0.0.1:${port[1]}`;
        resolve();
      }
    };
    server.stdout.on('data', collect);
    server.stderr.on('data', collect);
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
  });
});

after(async () => {
  for (const probe of sockets) probe.ws.terminate();
  if (server && server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM');
    await exited;
  }
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

async function request(method, route, token, data) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (data instanceof FormData) body = data;
  else if (data !== undefined) { body = JSON.stringify(data); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(base + route, { method, headers, body });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('application/json') ? await res.json() : await res.text() };
}

async function createUser(name, role = 'employee') {
  const email = `${name.toLowerCase()}@example.test`;
  const response = await request('POST', '/api/users', owner.token, { name, email, password: 'password123', role });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const login = await request('POST', '/api/auth/login', null, { email, password: 'password123' });
  assert.equal(login.status, 200);
  return login.body;
}

function uploadForm(projectId, projectFieldFirst = false, name = 'private.txt') {
  const form = new FormData();
  if (projectId && projectFieldFirst) form.append('projectId', projectId);
  form.append('file', new Blob(['confidential contents'], { type: 'text/plain' }), name);
  if (projectId && !projectFieldFirst) form.append('projectId', projectId);
  return form;
}

class Probe {
  constructor(ws) {
    this.ws = ws;
    this.events = [];
    this.waiters = new Set();
    ws.on('message', data => {
      const event = JSON.parse(data.toString());
      this.events.push(event);
      for (const waiter of [...this.waiters]) waiter();
    });
  }
  mark() { return this.events.length; }
  send(data) { this.ws.send(JSON.stringify(data)); }
  wait(predicate, from = 0, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = this.events.slice(from).find(predicate);
        if (found) { clearTimeout(timer); this.waiters.delete(check); resolve(found); }
      };
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`Timed out waiting for event; received ${JSON.stringify(this.events.slice(from))}`));
      }, timeout);
      this.waiters.add(check);
      check();
    });
  }
  async barrier() {
    const from = this.mark();
    this.send({ type: 'ping' });
    await this.wait(event => event.type === 'pong', from);
  }
}

async function connect(token) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
  const probe = new Probe(ws);
  sockets.push(probe);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  probe.send({ type: 'auth', token });
  await probe.wait(event => event.type === 'auth:ok');
  return probe;
}

test('only one first registration succeeds; later signup is closed', async () => {
  assert.equal((await request('GET', '/api/auth/bootstrap')).body.registrationOpen, true);
  const registrations = await Promise.all(['First', 'Second'].map(name =>
    request('POST', '/api/auth/register', null, { name, email: `${name}@example.test`, password: 'password123' })));
  assert.deepEqual(registrations.map(r => r.status).sort(), [200, 403]);
  owner = registrations.find(r => r.status === 200).body;
  assert.equal(owner.user.role, 'owner');
  assert.equal((await request('GET', '/api/auth/bootstrap')).body.registrationOpen, false);
  assert.equal((await request('POST', '/api/auth/register', null,
    { name: 'Stranger', email: 'stranger@example.test', password: 'password123' })).status, 403);
  [member, outsider, manager, viewer, admin] = await Promise.all([
    createUser('Member'), createUser('Outsider'), createUser('Manager', 'manager'),
    createUser('Viewer', 'viewer'), createUser('Admin', 'admin')
  ]);
});

test('a manager cannot promote themselves or grant administrative roles', async () => {
  assert.equal((await request('PATCH', `/api/users/${manager.user.id}`, manager.token, { role: 'admin' })).status, 403);
  assert.equal((await request('POST', '/api/users', manager.token,
    { name: 'Malicious', email: 'malicious@example.test', password: 'password123', role: 'owner' })).status, 403);
  assert.equal((await request('POST', '/api/users', manager.token,
    { name: 'Malicious', email: 'malicious@example.test', password: 'password123', role: 'manager' })).status, 403);
  assert.equal((await request('PATCH', `/api/users/${outsider.user.id}`, manager.token, { role: 'viewer' })).status, 403);
  assert.equal((await request('PATCH', `/api/users/${owner.user.id}`, manager.token, { name: 'Changed' })).status, 403);
  assert.equal((await request('PATCH', '/api/roles/manager', manager.token, { permissions: ['*'] })).status, 403);
});

test('project metadata, tasks, messages and files are limited to members and admins', async () => {
  const created = await request('POST', '/api/projects', owner.token,
    { name: 'Confidential client', memberIds: [member.user.id, viewer.user.id] });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  project = created.body.project;
  assert.equal((await request('GET', '/api/projects', outsider.token)).body.projects.length, 0);
  assert.equal((await request('GET', `/api/projects/${project.id}`, outsider.token)).status, 404);
  assert.equal((await request('GET', `/api/projects/${project.id}`, manager.token)).status, 404);
  assert.equal((await request('GET', `/api/projects/${project.id}`, member.token)).status, 200);
  assert.equal((await request('GET', `/api/projects/${project.id}`, admin.token)).status, 200);
  assert.equal((await request('POST', `/api/projects/${project.id}/members`, manager.token, { userId: manager.user.id })).status, 404);
  assert.equal((await request('POST', `/api/projects/${project.id}/members`, member.token, { userId: outsider.user.id })).status, 403);
  assert.equal((await request('GET', `/api/messages?channel=project:${project.id}`, outsider.token)).status, 404);
  assert.equal((await request('GET', '/api/messages?channel=dm:someone:else', member.token)).status, 404);
  assert.equal((await request('GET', '/api/channels', outsider.token)).body.channels.length, 1);

  const createdTask = await request('POST', `/api/projects/${project.id}/tasks`, owner.token,
    { title: 'Private task', assigneeId: member.user.id });
  assert.equal(createdTask.status, 200);
  task = createdTask.body.task;
  assert.equal((await request('POST', `/api/projects/${project.id}/tasks`, owner.token,
    { title: 'Leaking assignment', assigneeId: outsider.user.id })).status, 400);
  assert.equal((await request('GET', `/api/projects/${project.id}/tasks`, outsider.token)).status, 404);
  assert.equal((await request('PATCH', `/api/tasks/${task.id}`, outsider.token, { title: 'Stolen' })).status, 404);
  assert.equal((await request('POST', `/api/tasks/${task.id}/done`, viewer.token, {})).status, 403);
  assert.equal((await request('DELETE', `/api/tasks/${task.id}`, viewer.token)).status, 403);

  // Legacy clients may send projectId after the file; it must never become a global upload.
  const uploaded = await request('POST', '/api/files', owner.token, uploadForm(project.id));
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  projectFile = uploaded.body.file;
  assert.equal(projectFile.projectId, project.id);
  assert.equal((await request('GET', '/api/files', outsider.token)).body.files.length, 0);
  assert.equal((await request('GET', `/api/files?projectId=${project.id}`, outsider.token)).status, 404);
  assert.equal((await request('GET', `/api/files/${projectFile.id}/download`, outsider.token)).status, 404);
  const download = await request('GET', `/api/files/${projectFile.id}/download`, member.token);
  assert.equal(download.status, 200);
  assert.equal(download.body, 'confidential contents');
  assert.equal((await request('DELETE', `/api/files/${projectFile.id}`, outsider.token)).status, 404);
  assert.equal((await request('POST', '/api/files', outsider.token, uploadForm(project.id, true))).status, 404);
  assert.equal((await request('POST', `/api/files?projectId=${project.id}`, owner.token,
    uploadForm('other-project', true))).status, 400);
  assert.equal(readdirSync(path.join(tempDir, 'uploads')).length, 1, 'rejected uploads are removed');

  const globalFile = await request('POST', '/api/files', owner.token, uploadForm(null, false, 'shared.txt'));
  assert.equal(globalFile.status, 200);
  assert.equal(globalFile.body.file.projectId, null);
  assert.deepEqual((await request('GET', '/api/files', outsider.token)).body.files.map(f => f.id), [globalFile.body.file.id]);
});

test('realtime channels and broadcasts enforce membership, including revocation on an open socket', async () => {
  const ownerSocket = await connect(owner.token);
  const memberSocket = await connect(member.token);
  const outsiderSocket = await connect(outsider.token);
  const viewerSocket = await connect(viewer.token);
  const adminSocket = await connect(admin.token);
  const channel = `project:${project.id}`;
  ownerSocket.send({ type: 'subscribe', channel });
  memberSocket.send({ type: 'subscribe', channel });
  viewerSocket.send({ type: 'subscribe', channel });
  adminSocket.send({ type: 'subscribe', channel });
  await Promise.all([ownerSocket.barrier(), memberSocket.barrier(), viewerSocket.barrier(), adminSocket.barrier()]);
  const deniedMark = outsiderSocket.mark();
  outsiderSocket.send({ type: 'subscribe', channel });
  await outsiderSocket.wait(e => e.type === 'error', deniedMark);
  const deniedSend = outsiderSocket.mark();
  outsiderSocket.send({ type: 'chat:send', channel, text: 'intruder' });
  await outsiderSocket.wait(e => e.type === 'error', deniedSend);
  const viewerSend = viewerSocket.mark();
  viewerSocket.send({ type: 'chat:send', channel, text: 'viewer cannot write' });
  await viewerSocket.wait(e => e.type === 'error', viewerSend);

  const outsiderMark = outsiderSocket.mark();
  const memberMark = memberSocket.mark();
  ownerSocket.send({ type: 'chat:send', channel, text: 'client secret' });
  await memberSocket.wait(e => e.type === 'chat:message' && e.message.text === 'client secret', memberMark);
  assert.equal((await request('GET', `/api/messages?channel=${channel}`, member.token)).body.messages[0].text, 'client secret');
  await request('PATCH', `/api/projects/${project.id}`, owner.token, { name: 'Renamed confidential client' });
  await request('POST', '/api/files', owner.token, uploadForm(project.id, true, 'another-private.txt'));
  await outsiderSocket.barrier();
  assert.equal(outsiderSocket.events.slice(outsiderMark).some(e =>
    e.type === 'chat:message' || e.type === 'project:update' || e.type === 'file:new' || e.type === 'notification'), false);

  const adminMark = adminSocket.mark();
  assert.equal((await request('PATCH', `/api/users/${admin.user.id}`, owner.token, { role: 'employee' })).status, 200);
  await adminSocket.wait(e => e.type === 'project:access-revoked' && e.projectId === project.id, adminMark);
  assert.equal((await request('GET', `/api/projects/${project.id}`, admin.token)).status, 404);

  const revocationMark = memberSocket.mark();
  assert.equal((await request('DELETE', `/api/projects/${project.id}/members/${member.user.id}`, owner.token)).status, 200);
  await memberSocket.wait(e => e.type === 'project:access-revoked' && e.projectId === project.id, revocationMark);
  assert.equal((await request('GET', `/api/projects/${project.id}`, member.token)).status, 404);
  assert.equal((await request('GET', `/api/files/${projectFile.id}/download`, member.token)).status, 404);
  assert.equal((await request('GET', `/api/projects/${project.id}/tasks`, owner.token)).body.tasks[0].assigneeId, null);
  const afterRevocation = memberSocket.mark();
  ownerSocket.send({ type: 'chat:send', channel, text: 'after revocation' });
  await ownerSocket.wait(e => e.type === 'chat:message' && e.message.text === 'after revocation');
  await request('PATCH', `/api/tasks/${task.id}`, owner.token, { title: 'Updated secret' });
  await memberSocket.barrier();
  assert.equal(memberSocket.events.slice(afterRevocation).some(e =>
    e.type === 'chat:message' || e.type.startsWith('task:') || e.type === 'notification'), false);
});

test('an upload started before deactivation cannot finish using a revoked session', async () => {
  const uploader = await createUser('Streaming');
  assert.equal((await request('POST', `/api/projects/${project.id}/members`, owner.token, { userId: uploader.user.id })).status, 200);
  const uploadDir = path.join(tempDir, 'uploads');
  const before = new Set(readdirSync(uploadDir));
  const boundary = 'nexa-slow-upload-boundary';
  let writer;
  const stream = new ReadableStream({
    start(controller) {
      writer = controller;
      controller.enqueue(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="projectId"\r\n\r\n${project.id}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slow.txt"\r\nContent-Type: text/plain\r\n\r\nfirst chunk`));
    }
  });
  const pending = fetch(`${base}/api/files`, { method: 'POST',
    headers: { authorization: `Bearer ${uploader.token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: stream, duplex: 'half' });
  const deadline = Date.now() + 5000;
  while (readdirSync(uploadDir).every(name => before.has(name)) && Date.now() < deadline) await sleep(10);
  assert.ok(readdirSync(uploadDir).some(name => !before.has(name)), 'server accepted the start of the stream');
  assert.equal((await request('DELETE', `/api/users/${uploader.user.id}`, owner.token)).status, 200);
  assert.equal((await request('POST', `/api/users/${uploader.user.id}/reactivate`, owner.token, {})).status, 200);
  assert.equal((await request('POST', `/api/projects/${project.id}/members`, owner.token, { userId: uploader.user.id })).status, 200);
  writer.enqueue(Buffer.from(` last chunk\r\n--${boundary}--\r\n`));
  writer.close();
  assert.equal((await pending).status, 403);
  assert.deepEqual(readdirSync(uploadDir).filter(name => !before.has(name)), [], 'partial file was removed');
});

test('deactivation revokes sessions while preserving authored content and project history', async () => {
  const employee = await createUser('Offboard');
  assert.equal((await request('POST', `/api/projects/${project.id}/members`, owner.token, { userId: employee.user.id })).status, 200);
  const authored = await request('POST', `/api/projects/${project.id}/tasks`, employee.token,
    { title: 'Work to preserve', assigneeId: employee.user.id });
  assert.equal(authored.status, 200);
  const uploaded = await request('POST', '/api/files', employee.token, uploadForm(project.id, true, 'authored.txt'));
  assert.equal(uploaded.status, 200);
  const socket = await connect(employee.token);
  socket.send({ type: 'subscribe', channel: `project:${project.id}` });
  await socket.barrier();
  const mark = socket.mark();
  socket.send({ type: 'chat:send', channel: `project:${project.id}`, text: 'Historical message' });
  await socket.wait(e => e.type === 'chat:message' && e.message.text === 'Historical message', mark);
  const closed = new Promise(resolve => socket.ws.once('close', code => resolve(code)));

  const deactivated = await request('DELETE', `/api/users/${employee.user.id}`, owner.token);
  assert.equal(deactivated.status, 200);
  assert.ok(deactivated.body.user.disabledAt);
  assert.equal(await closed, 4001);
  assert.equal((await request('GET', '/api/auth/me', employee.token)).status, 401);
  assert.equal((await request('POST', '/api/auth/login', null,
    { email: 'offboard@example.test', password: 'password123' })).status, 401);
  assert.equal((await request('GET', '/api/users', owner.token)).body.users.some(u => u.id === employee.user.id), false);
  assert.equal((await request('GET', '/api/users?includeInactive=true', owner.token)).body.users.some(u => u.id === employee.user.id), true);
  assert.equal((await request('GET', '/api/users?includeInactive=true', outsider.token)).status, 403);
  assert.equal((await request('GET', `/api/files/${uploaded.body.file.id}/download`, owner.token)).body, 'confidential contents');
  assert.equal((await request('GET', `/api/messages?channel=project:${project.id}`, owner.token)).body.messages.some(m => m.text === 'Historical message'), true);
  const preserved = (await request('GET', `/api/projects/${project.id}/tasks`, owner.token)).body.tasks.find(t => t.id === authored.body.task.id);
  assert.equal(preserved.title, 'Work to preserve');
  assert.equal(preserved.assigneeId, null);

  assert.equal((await request('POST', `/api/users/${employee.user.id}/reactivate`, manager.token, {})).status, 403);
  assert.equal((await request('POST', `/api/users/${employee.user.id}/reactivate`, owner.token, {})).status, 200);
  assert.equal((await request('GET', '/api/auth/me', employee.token)).status, 401, 'old sessions stay revoked after reactivation');
  const login = await request('POST', '/api/auth/login', null, { email: 'offboard@example.test', password: 'password123' });
  assert.equal(login.status, 200);
  assert.equal((await request('GET', `/api/projects/${project.id}`, login.body.token)).status, 404, 'old memberships are not restored');
});

test('deleting a project or its owner cannot expose private files', async () => {
  const owned = await request('POST', '/api/projects', manager.token, { name: 'Manager project' });
  assert.equal(owned.status, 200);
  const confidential = await request('POST', '/api/files', owner.token, uploadForm(owned.body.project.id, true, 'manager-secret.txt'));
  assert.equal(confidential.status, 200);
  assert.equal((await request('DELETE', `/api/users/${manager.user.id}`, owner.token)).status, 200);
  assert.equal((await request('GET', `/api/projects/${owned.body.project.id}`, manager.token)).status, 401);
  assert.equal((await request('GET', `/api/projects/${owned.body.project.id}`, owner.token)).status, 200, 'owned project is preserved');
  assert.equal((await request('GET', `/api/files/${confidential.body.file.id}/download`, outsider.token)).status, 404);
  assert.equal((await request('POST', `/api/users/${manager.user.id}/reactivate`, owner.token, {})).status, 200);
  assert.equal((await request('GET', '/api/auth/me', manager.token)).status, 401);
  assert.equal((await request('DELETE', `/api/projects/${project.id}`, owner.token)).status, 200);
  assert.equal((await request('GET', `/api/files/${projectFile.id}/download`, owner.token)).status, 404);
  assert.equal((await request('GET', '/api/files', outsider.token)).body.files.some(f => f.name === 'private.txt'), false);
  assert.equal(readdirSync(path.join(tempDir, 'uploads')).some(name => name.includes('private.txt')), false);
});

test('JWT expiry and required claims apply to HTTP and already-open sockets', async () => {
  const secret = 'test-secret-that-is-at-least-32-characters-long';
  const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const sign = claims => {
    const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
    return input + '.' + crypto.createHmac('sha256', secret).update(input).digest('base64url');
  };
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await request('GET', '/api/auth/me', sign({ sub: member.user.id, iat: now }))).status, 401);
  assert.equal((await request('GET', '/api/auth/me', sign({ sub: member.user.id, iat: now - 3, exp: now - 1 }))).status, 401);
  const expires = Math.floor(Date.now() / 1000) + 2;
  const shortToken = sign({ sub: member.user.id, iat: now, exp: expires, sv: 0 });
  const socket = await connect(shortToken);
  const closed = new Promise(resolve => socket.ws.once('close', code => resolve(code)));
  await sleep(Math.max(0, expires * 1000 - Date.now()) + 50);
  socket.send({ type: 'ping' });
  assert.equal(await closed, 4001);
  assert.equal((await request('GET', '/api/auth/me', shortToken)).status, 401);
});

test('tokens forged with the old shared default secret are rejected', async () => {
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: owner.user.id, exp: Math.floor(Date.now() / 1000) + 3600 });
  const signature = crypto.createHmac('sha256', 'nexa-dev-secret-change-me').update(`${header}.${payload}`).digest('base64url');
  assert.equal((await request('GET', '/api/auth/me', `${header}.${payload}.${signature}`)).status, 401);
});

test('unconfigured installations generate unique, persistent signing secrets', () => {
  const script = "import {loadJwtSecret} from './src/secret.js'; console.log(loadJwtSecret())";
  const dirA = path.join(tempDir, 'secret-a');
  const dirB = path.join(tempDir, 'secret-b');
  // Delete the inherited environment variable rather than passing an empty key.
  const freshSecret = dir => {
    const env = { ...process.env, NEXA_DATA_DIR: dir };
    delete env.NEXA_JWT_SECRET;
    return execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: serverDir, encoding: 'utf8', env }).trim();
  };
  const a = freshSecret(dirA);
  assert.equal(freshSecret(dirA), a);
  assert.notEqual(freshSecret(dirB), a);
  assert.equal(readFileSync(path.join(dirA, 'jwt-secret'), 'utf8'), a);
  if (process.platform !== 'win32') assert.equal(statSync(path.join(dirA, 'jwt-secret')).mode & 0o777, 0o600);
});


test('existing databases migrate account status fields without losing users', async () => {
  const dir = path.join(tempDir, 'legacy-db');
  mkdirSync(dir, { recursive: true });
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'employee', avatar_color TEXT NOT NULL,
    title TEXT, created_at INTEGER NOT NULL, last_seen INTEGER)`);
  db.run(`INSERT INTO users (id,email,name,password_hash,role,avatar_color,created_at)
    VALUES ('legacy','legacy@example.test','Legacy','hash','owner','#ffffff',1)`);
  writeFileSync(path.join(dir, 'nexa.db'), Buffer.from(db.export()));
  db.close();
  const script = "import {initDb,get} from './src/db/index.js'; await initDb(); console.log(JSON.stringify(get('SELECT id, disabled_at, session_version FROM users WHERE id = ?', ['legacy'])))";
  const env = { ...process.env, NEXA_DATA_DIR: dir };
  const runMigration = () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: serverDir, encoding: 'utf8', env }).trim());
  assert.deepEqual(runMigration(), { id: 'legacy', disabled_at: null, session_version: 0 });
  assert.deepEqual(runMigration(), { id: 'legacy', disabled_at: null, session_version: 0 });
});
