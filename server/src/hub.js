// Central realtime hub.
// In local/production mode (real HTTP server) this creates a WebSocket pub/sub bus.
// In Vercel serverless mode (no long-lived server) we create a NoopHub that records
// broadcast events into an in-memory ring buffer consumed by the /api/poll endpoint
// so that polling clients still see "realtime" updates within ~1-2 seconds.
import { WebSocketServer } from 'ws';
import { nanoid } from 'nanoid';
import { all, get, run } from './db/index.js';

const AVATAR_PALETTE = [
  '#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#10b981',
  '#14b8a6','#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7',
  '#d946ef','#ec4899','#f43f5e'
];
export function pickColor(seed) {
  let h = 0; for (let i=0;i<seed.length;i++) h = (h*31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

// ---- In-memory event ring buffer (used by WS hub AND polling fallback) ----
const EVENT_RING = [];
const RING_MAX = 500;
export function ringPush(ev) {
  ev.id = ev.id || nanoid(10);
  ev.ts = Date.now();
  EVENT_RING.push(ev);
  if (EVENT_RING.length > RING_MAX) EVENT_RING.splice(0, EVENT_RING.length - RING_MAX);
}
export function ringSince(cursor) {
  if (!EVENT_RING.length) return { events: [], cursor: Date.now() };
  if (!cursor) return { events: EVENT_RING.slice(), cursor: EVENT_RING[EVENT_RING.length-1].ts };
  let start = EVENT_RING.findIndex(e => e.ts > cursor);
  if (start < 0) start = EVENT_RING.length;
  return { events: EVENT_RING.slice(start), cursor: EVENT_RING[EVENT_RING.length-1].ts };
}

// ---- Noop hub: records events, no websockets ----
class NoopHub {
  publish() {}
  subscribeUserToChannel() {}
  persistMessage(user, channel, text, replyTo) {
    const id = nanoid(12);
    const now = Date.now();
    run(`INSERT INTO messages (id, channel_id, author_id, text, reply_to, created_at) VALUES (?,?,?,?,?,?)`,
      [id, channel, user.id, text, replyTo, now]);
    return { id, channel, text, replyTo, createdAt: now, author: publicUser(user), reactions: [] };
  }
  broadcastMessage(message, actor) {
    this.publish('channel:' + message.channel, { type: 'chat:message', message });
    this.notifyChannelMembers(message, actor);
  }
  notifyChannelMembers(message, actor) {
    if (!message.channel.startsWith('project:')) return;
    const projectId = message.channel.slice('project:'.length);
    const members = all(`SELECT u.* FROM users u JOIN project_members pm ON pm.user_id = u.id WHERE pm.project_id = ?`, [projectId]);
    for (const m of members) if (m.id !== actor.id) this.sendToUser(m.id, {
      type: 'notification',
      notification: { id: nanoid(10), type: 'chat:mention', title: `${actor.name} in #${projectId}`, body: message.text.slice(0,120), createdAt: message.createdAt, read: false }
    });
  }
  emitToChannel(channel, ev) { ringPush({ scope: 'channel', channel, ...ev }); }
  sendToUser(userId, ev) { ringPush({ scope: 'user', userId, ...ev }); }
  broadcast(kind, data) { ringPush({ scope: 'global', type: kind, ...data }); }
  emitTaskChanged(projectId, task, actor, action='update') {
    ringPush({ scope: 'project', projectId, type: 'task:'+action, task, actor: publicUser(actor) });
    if (task.assignee_id && task.assignee_id !== actor.id) {
      ringPush({ scope: 'user', userId: task.assignee_id, type: 'notification',
        notification: { id: nanoid(10), type: 'task:'+action, title: `Task ${action}: ${task.title}`, body: action==='done'?'Marked as done':'Updated', createdAt: Date.now(), read: false, taskId: task.id, projectId }});
    }
  }
  emitProjectChanged(project, action='update') { ringPush({ scope: 'global', type: 'project:'+action, project }); }
  emitFileUploaded(file, uploader) { ringPush({ scope: 'global', type: 'file:new', file, uploader: publicUser(uploader) }); }
}

// ---- Real WebSocket hub ----
class WsHub extends NoopHub {
  constructor(server) {
    super();
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.clients = new Map();
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    this._tickInterval = setInterval(() => this.tick(), 5000);
  }
  onConnection(ws, req) {
    const clientId = nanoid(12);
    const ctx = { ws, user: null, channels: new Set() };
    this.clients.set(clientId, ctx);
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      this.handle(clientId, ctx, msg).catch(err => this.send(ws, { type: 'error', message: err.message }));
    });
    ws.on('close', () => this.disconnect(clientId, ctx));
    this.send(ws, { type: 'hello', clientId });
  }
  disconnect(clientId, ctx) {
    if (ctx.user) {
      run('UPDATE users SET last_seen = ? WHERE id = ?', [Date.now(), ctx.user.id]);
      this.broadcast('presence', { userId: ctx.user.id, online: false, lastSeen: Date.now() });
    }
    this.clients.delete(clientId);
  }
  async handle(clientId, ctx, msg) {
    if (msg.type === 'auth') {
      const user = await this.authenticate(msg.token);
      if (!user) return this.send(ctx.ws, { type: 'auth:error', message: 'invalid token' });
      ctx.user = user;
      ctx.channels.add('user:' + user.id);
      ctx.channels.add('channel:global');
      run('UPDATE users SET last_seen = ? WHERE id = ?', [Date.now(), user.id]);
      this.send(ctx.ws, { type: 'auth:ok', user: publicUser(user) });
      this.broadcast('presence', { userId: user.id, online: true, user: publicUser(user) });
      this.sendOnlineRoster(ctx);
      return;
    }
    if (!ctx.user) return this.send(ctx.ws, { type: 'auth:required' });
    switch (msg.type) {
      case 'subscribe': if (msg.channel) ctx.channels.add('channel:'+msg.channel); break;
      case 'unsubscribe': ctx.channels.delete('channel:'+msg.channel); break;
      case 'chat:send': await this.handleChatMessage(ctx, msg); break;
      case 'typing': await this.handleTyping(ctx, msg); break;
      case 'ping': this.send(ctx.ws, { type: 'pong', t: Date.now() }); break;
      default: this.send(ctx.ws, { type: 'error', message: 'unknown: '+msg.type });
    }
  }
  async authenticate(token) {
    try {
      const { createVerifier } = await import('./auth.js');
      const payload = createVerifier()(token);
      return get('SELECT * FROM users WHERE id = ?', [payload.sub]);
    } catch { return null; }
  }
  send(ws, ev) { if (ws.readyState === 1) ws.send(JSON.stringify(ev)); }
  publish(topic, ev) {
    ringPush(ev);
    for (const ctx of this.clients.values()) if (ctx.channels.has(topic)) this.send(ctx.ws, ev);
  }
  subscribeUserToChannel(userId, channelId) {
    for (const c of this.clients.values()) if (c.user && c.user.id === userId) c.channels.add('channel:' + channelId);
  }
  emitToChannel(channel, ev) {
    this.publish('channel:' + channel, ev);
  }
  broadcast(kind, data) {
    const ev = { type: kind, ...data };
    ringPush(ev);
    for (const ctx of this.clients.values()) if (ctx.user) this.send(ctx.ws, ev);
  }
  sendToUser(userId, ev) {
    ringPush({ scope: 'user', userId, ...ev });
    let sent = false;
    for (const ctx of this.clients.values()) {
      if (ctx.user && ctx.user.id === userId) { this.send(ctx.ws, ev); sent = true; }
    }
    return sent;
  }
  sendOnlineRoster(ctx) {
    const online = [];
    for (const c of this.clients.values()) if (c.user) online.push(publicUser(c.user));
    this.send(ctx.ws, { type: 'presence:roster', users: online });
  }
  async handleChatMessage(ctx, msg) {
    const { text, channel='global', replyTo } = msg;
    if (!text || !text.trim()) return;
    const message = this.persistMessage(ctx.user, channel, text.trim(), replyTo||null);
    this.publish('channel:'+channel, { type: 'chat:message', message });
    if (channel.startsWith('dm:')) {
      // DM participants may not be subscribed to the dm channel yet — push onto
      // their always-on user channels + a notification.
      const [a, b] = channel.slice(3).split(':');
      for (const uid of [a, b]) {
        if (uid !== ctx.user.id) {
          this.sendToUser(uid, { type: 'chat:message', message });
          this.sendToUser(uid, {
            type: 'notification',
            notification: { id: nanoid(10), type: 'chat:dm', title: `${ctx.user.name} · direct message`, body: message.text.slice(0,120), createdAt: message.createdAt, read: false, channel }
          });
        }
      }
    } else {
      this.notifyChannelMembers(message, ctx.user);
    }
  }
  async handleTyping(ctx, msg) {
    const { channel='global', isTyping } = msg;
    if (isTyping) run(`INSERT INTO typing (channel_id, user_id, updated_at) VALUES (?,?,?) ON CONFLICT(channel_id, user_id) DO UPDATE SET updated_at=excluded.updated_at`, [channel, ctx.user.id, Date.now()]);
    else run('DELETE FROM typing WHERE channel_id = ? AND user_id = ?', [channel, ctx.user.id]);
    const ev = { type: 'typing', channel, user: publicUser(ctx.user), isTyping: !!isTyping };
    // typing is transient — don't persist to ring buffer, only push to connected clients
    for (const c of this.clients.values()) if (c.channels.has('channel:'+channel)) this.send(c.ws, ev);
  }
  tick() {
    const cutoff = Date.now() - 8000;
    const stale = all('SELECT channel_id, user_id FROM typing WHERE updated_at < ?', [cutoff]);
    if (stale.length) {
      run('DELETE FROM typing WHERE updated_at < ?', [cutoff]);
      for (const s of stale) {
        const u = get('SELECT * FROM users WHERE id = ?', [s.user_id]);
        if (u) {
          const ev = { type: 'typing', channel: s.channel_id, user: publicUser(u), isTyping: false };
          for (const c of this.clients.values()) if (c.channels.has('channel:'+s.channel_id)) this.send(c.ws, ev);
        }
      }
    }
  }
}

export function createHub(server) {
  return server ? new WsHub(server) : new NoopHub();
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, avatarColor: u.avatar_color, title: u.title || null };
}
