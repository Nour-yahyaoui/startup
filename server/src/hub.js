// Realtime events are authorized at subscription, on every inbound action, and
// again at delivery so removing a member takes effect on an already-open socket.
import { WebSocketServer } from 'ws';
import { nanoid } from 'nanoid';
import { all, get, run } from './db/index.js';
import { canAccessChannel, getAccessibleProject, hasPermission } from './access.js';

const AVATAR_PALETTE = [
  '#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#10b981',
  '#14b8a6','#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7',
  '#d946ef','#ec4899','#f43f5e'
];
export function pickColor(seed) {
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export class Hub {
  constructor(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.clients = new Map();
    this.wss.on('connection', (ws) => this.onConnection(ws));
    this.timer = setInterval(() => this.tick(), 5000);
    this.timer.unref();
  }

  onConnection(ws) {
    const clientId = nanoid(12);
    const ctx = { ws, user: null, expiresAt: 0, sessionVersion: 0, channels: new Set(), inbox: Promise.resolve() };
    this.clients.set(clientId, ctx);
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      // Preserve ordering even while an authentication message awaits verification.
      ctx.inbox = ctx.inbox.then(() => this.handle(ctx, msg)).catch(() => {
        this.send(ws, { type: 'error', message: 'Unable to process realtime request' });
      });
    });
    ws.on('close', () => this.disconnect(clientId, ctx));
    this.send(ws, { type: 'hello', clientId });
  }

  disconnect(clientId, ctx) {
    this.clients.delete(clientId);
    if (ctx.user && ![...this.clients.values()].some(c => c.user?.id === ctx.user.id)) {
      if (get('SELECT id FROM users WHERE id = ?', [ctx.user.id])) {
        run('UPDATE users SET last_seen = ? WHERE id = ?', [Date.now(), ctx.user.id]);
        this.broadcast('presence', { userId: ctx.user.id, online: false, lastSeen: Date.now() });
      }
    }
  }

  currentUser(ctx) {
    if (!ctx.user) return null;
    if (Date.now() >= ctx.expiresAt) {
      ctx.ws.close(4001, 'Session expired');
      return null;
    }
    const user = get('SELECT * FROM users WHERE id = ?', [ctx.user.id]);
    if (!user || user.disabled_at != null || user.session_version !== ctx.sessionVersion) {
      ctx.ws.close(4001, 'Session invalidated');
      return null;
    }
    ctx.user = user; // Roles and membership can change while the socket is open.
    return user;
  }

  async handle(ctx, msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    if (msg.type === 'auth') {
      const session = await this.authenticate(msg.token);
      if (!session) {
        this.send(ctx.ws, { type: 'auth:error', message: 'Invalid token' });
        ctx.ws.close(4001, 'Invalid token');
        return;
      }
      ctx.user = session.user;
      ctx.expiresAt = session.expiresAt;
      ctx.sessionVersion = session.user.session_version;
      ctx.channels = new Set(['user:' + session.user.id, 'channel:global']);
      run('UPDATE users SET last_seen = ? WHERE id = ?', [Date.now(), session.user.id]);
      this.send(ctx.ws, { type: 'auth:ok', user: publicUser(session.user) });
      this.broadcast('presence', { userId: session.user.id, online: true, user: publicUser(session.user) });
      this.sendOnlineRoster(ctx);
      return;
    }
    const user = this.currentUser(ctx);
    if (!user) return this.send(ctx.ws, { type: 'auth:required' });

    switch (msg.type) {
      case 'subscribe':
        if (!canAccessChannel(user, msg.channel)) return this.forbidden(ctx);
        ctx.channels.add('channel:' + msg.channel);
        break;
      case 'unsubscribe':
        if (typeof msg.channel === 'string') ctx.channels.delete('channel:' + msg.channel);
        break;
      case 'chat:send':
        if (!canAccessChannel(user, msg.channel || 'global') || !hasPermission(user, 'chat.write')) return this.forbidden(ctx);
        this.handleChatMessage(ctx, msg);
        break;
      case 'typing':
        if (!canAccessChannel(user, msg.channel || 'global') || !hasPermission(user, 'chat.write')) return this.forbidden(ctx);
        this.handleTyping(ctx, msg);
        break;
      case 'ping':
        this.send(ctx.ws, { type: 'pong', t: Date.now() });
        break;
      default:
        this.send(ctx.ws, { type: 'error', message: 'Unknown realtime request' });
    }
  }

  async authenticate(token) {
    try {
      const { createVerifier, getSessionUser } = await import('./auth.js');
      const payload = createVerifier()(token);
      if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) return null;
      const user = getSessionUser(payload);
      return user ? { user, expiresAt: payload.exp * 1000 } : null;
    } catch { return null; }
  }

  send(ws, ev) {
    if (ws.readyState === 1) ws.send(JSON.stringify(ev));
  }

  forbidden(ctx) {
    this.send(ctx.ws, { type: 'error', message: 'You do not have access to this project or action.' });
  }

  publish(topic, event) {
    const channel = topic.startsWith('channel:') ? topic.slice('channel:'.length) : null;
    for (const ctx of this.clients.values()) {
      if (!ctx.channels.has(topic)) continue;
      const user = this.currentUser(ctx);
      if (!user) continue;
      if (channel && !canAccessChannel(user, channel)) {
        ctx.channels.delete(topic);
        continue;
      }
      this.send(ctx.ws, event);
    }
  }

  broadcast(kind, data) {
    for (const ctx of this.clients.values()) {
      if (this.currentUser(ctx)) this.send(ctx.ws, { type: kind, ...data });
    }
  }

  broadcastProject(projectId, event) {
    for (const ctx of this.clients.values()) {
      const user = this.currentUser(ctx);
      if (user && getAccessibleProject(user, projectId)) this.send(ctx.ws, event);
    }
  }

  sendToUser(userId, event) {
    for (const ctx of this.clients.values()) {
      const user = this.currentUser(ctx);
      if (user?.id === userId) this.send(ctx.ws, event);
    }
  }

  notifyUsers(userIds, event) {
    const recipients = new Set(userIds);
    for (const ctx of this.clients.values()) {
      const user = this.currentUser(ctx);
      if (user && recipients.has(user.id)) this.send(ctx.ws, event);
    }
  }

  revokeProjectAccess(userId, projectId) {
    for (const ctx of this.clients.values()) {
      const user = this.currentUser(ctx);
      if (user?.id === userId && !getAccessibleProject(user, projectId)) {
        ctx.channels.delete('channel:project:' + projectId);
        this.send(ctx.ws, { type: 'project:access-revoked', projectId });
      }
    }
  }

  revalidateUserProjects(userId) {
    for (const ctx of this.clients.values()) {
      const user = this.currentUser(ctx);
      if (user?.id !== userId) continue;
      for (const topic of [...ctx.channels]) {
        if (topic.startsWith('channel:project:')) {
          const projectId = topic.slice('channel:project:'.length);
          if (!getAccessibleProject(user, projectId)) {
            ctx.channels.delete(topic);
            this.send(ctx.ws, { type: 'project:access-revoked', projectId });
          }
        }
      }
    }
  }

  forgetProject(projectId) {
    for (const ctx of this.clients.values()) ctx.channels.delete('channel:project:' + projectId);
  }

  sendOnlineRoster(ctx) {
    const online = new Map();
    for (const client of this.clients.values()) {
      const user = this.currentUser(client);
      if (user) online.set(user.id, publicUser(user));
    }
    this.send(ctx.ws, { type: 'presence:roster', users: [...online.values()] });
  }

  handleChatMessage(ctx, msg) {
    const { text, channel = 'global', replyTo } = msg;
    if (typeof text !== 'string' || !text.trim() || text.length > 20000) return;
    if (replyTo && !get('SELECT id FROM messages WHERE id = ? AND channel_id = ?', [replyTo, channel])) {
      return this.send(ctx.ws, { type: 'error', message: 'Reply must belong to this channel' });
    }
    const id = nanoid(12);
    const now = Date.now();
    run(`INSERT INTO messages (id, channel_id, author_id, text, reply_to, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`, [id, channel, ctx.user.id, text.trim(), replyTo || null, now]);
    const message = { id, channel, text: text.trim(), replyTo: replyTo || null, createdAt: now, author: publicUser(ctx.user) };
    this.publish('channel:' + channel, { type: 'chat:message', message });
    if (channel.startsWith('project:')) {
      const projectId = channel.slice('project:'.length);
      const members = all(`SELECT u.* FROM users u JOIN project_members pm ON pm.user_id = u.id
                           WHERE pm.project_id = ?`, [projectId]);
      for (const member of members) {
        if (member.id !== ctx.user.id && getAccessibleProject(member, projectId)) {
          this.sendToUser(member.id, {
            type: 'notification',
            notification: {
              id: nanoid(10), type: 'chat:mention',
              title: `${ctx.user.name} in #${channel}`, body: text.trim().slice(0, 120),
              createdAt: now, read: false, projectId
            }
          });
        }
      }
    }
  }

  handleTyping(ctx, msg) {
    const { channel = 'global', isTyping } = msg;
    if (isTyping) {
      run(`INSERT INTO typing (channel_id, user_id, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(channel_id, user_id) DO UPDATE SET updated_at = excluded.updated_at`,
        [channel, ctx.user.id, Date.now()]);
    } else {
      run('DELETE FROM typing WHERE channel_id = ? AND user_id = ?', [channel, ctx.user.id]);
    }
    this.publish('channel:' + channel, { type: 'typing', channel, user: publicUser(ctx.user), isTyping: !!isTyping });
  }

  tick() {
    const stale = all('SELECT channel_id, user_id FROM typing WHERE updated_at < ?', [Date.now() - 8000]);
    if (stale.length) {
      run('DELETE FROM typing WHERE updated_at < ?', [Date.now() - 8000]);
      for (const row of stale) {
        const user = get('SELECT * FROM users WHERE id = ?', [row.user_id]);
        if (user) this.publish('channel:' + row.channel_id, { type: 'typing', channel: row.channel_id, user: publicUser(user), isTyping: false });
      }
    }
  }

  emitTaskChanged(projectId, task, actor, action = 'update') {
    this.publish('channel:project:' + projectId, { type: 'task:' + action, task, actor: publicUser(actor) });
    if (task.assigneeId && task.assigneeId !== actor.id) {
      const assignee = get('SELECT * FROM users WHERE id = ?', [task.assigneeId]);
      if (getAccessibleProject(assignee, projectId)) {
        this.sendToUser(task.assigneeId, {
          type: 'notification',
          notification: {
            id: nanoid(10), type: 'task:' + action,
            title: `Task ${action}: ${task.title}`,
            body: action === 'done' ? 'Marked as done' : 'Assigned or updated',
            createdAt: Date.now(), read: false, taskId: task.id, projectId
          }
        });
      }
    }
  }

  emitProjectChanged(project, action = 'update') {
    this.broadcastProject(project.id, { type: 'project:' + action, project });
  }

  emitFileUploaded(file, uploader) {
    const event = { type: 'file:new', file, uploader: publicUser(uploader) };
    if (file.projectId) this.broadcastProject(file.projectId, event);
    else this.broadcast('file:new', { file, uploader: publicUser(uploader) });
  }

  emitFileDeleted(file) {
    const event = { type: 'file:delete', fileId: file.id, projectId: file.project_id };
    if (file.project_id) this.broadcastProject(file.project_id, event);
    else this.broadcast('file:delete', { fileId: file.id, projectId: null });
  }
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, avatarColor: u.avatar_color, title: u.title || null, disabledAt: u.disabled_at ?? null };
}
