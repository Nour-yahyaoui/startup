import { all, get, run } from '../db/index.js';
import { publicUser } from '../hub.js';
import { nanoid } from 'nanoid';

export function dmChannelId(a, b) {
  return 'dm:' + [a, b].sort().join(':');
}

export async function chatRoutes(app) {
  const auth = app.authenticate;

  // ---- channel list: global + projects + DMs, with unread counts + previews ----
  app.get('/api/channels', { preHandler: [auth] }, async (req) => {
    const me = req.user.id;
    const isAdmin = req.user.role === 'owner' || req.user.role === 'admin';
    const projects = isAdmin
      ? all(`SELECT id, name, color FROM projects WHERE archived = 0`)
      : all(`SELECT p.id, p.name, p.color FROM projects p
             LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
             WHERE p.archived = 0 AND (p.owner_id = ? OR pm.user_id IS NOT NULL)`,
             [me, me]);

    // DMs: any channel I have messages in that starts with dm:
    const dmRows = all(
      `SELECT DISTINCT m.channel_id FROM messages m
       WHERE m.channel_id LIKE 'dm:' || ? || ':%' OR m.channel_id LIKE '%:' || ? || ':dm:%'
          OR (m.channel_id LIKE 'dm:%' AND (m.channel_id LIKE '%' || ? || ':%'))`,
      [me, me, me]
    );
    // simpler + correct: parse in JS
    const allDm = all(`SELECT DISTINCT channel_id FROM messages WHERE channel_id LIKE 'dm:%'`);
    const myDmIds = allDm.map(r => r.channel_id).filter(id => {
      const parts = id.slice(3).split(':');
      return parts.length === 2 && parts.includes(me);
    });

    const channels = [
      { id: 'global', name: 'General', kind: 'global', color: '#6366f1' },
      ...projects.map(p => ({ id: 'project:' + p.id, name: p.name, kind: 'project', color: p.color })),
      ...myDmIds.map(id => {
        const otherId = id.slice(3).split(':').find(x => x !== me);
        const u = get('SELECT * FROM users WHERE id = ?', [otherId]);
        return { id, name: u ? u.name : 'Unknown', kind: 'dm', color: u ? u.avatar_color : '#888', otherUser: u ? publicUser(u) : null };
      }),
    ];

    const reads = {};
    for (const r of all('SELECT channel_id, last_read_at FROM channel_reads WHERE user_id = ?', [me])) {
      reads[r.channel_id] = r.last_read_at;
    }

    const previews = {};
    const unread = {};
    for (const ch of channels) {
      const row = get(
        `SELECT m.*, u.name as author_name, u.avatar_color as author_color, u.role as author_role
         FROM messages m JOIN users u ON u.id = m.author_id
         WHERE m.channel_id = ? ORDER BY m.created_at DESC LIMIT 1`, [ch.id]
      );
      if (row) previews[ch.id] = mapMessage(row, me);
      const lastRead = reads[ch.id] || 0;
      const c = get(
        `SELECT COUNT(*) as c FROM messages
         WHERE channel_id = ? AND created_at > ? AND author_id != ?`,
        [ch.id, lastRead, me]
      );
      unread[ch.id] = c ? c.c : 0;
    }
    return { channels, previews, unread };
  });

  // ---- start (or get) a DM with a user ----
  app.post('/api/chat/dm', { preHandler: [auth] }, async (req, reply) => {
    const { userId } = req.body || {};
    if (!userId) return reply.code(400).send({ error: 'userId required' });
    if (userId === req.user.id) return reply.code(400).send({ error: 'Cannot DM yourself' });
    const other = get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!other) return reply.code(404).send({ error: 'User not found' });
    const id = dmChannelId(req.user.id, userId);
    app.hub.subscribeUserToChannel(userId, id);
    app.hub.subscribeUserToChannel(req.user.id, id);
    return { channel: { id, name: other.name, kind: 'dm', color: other.avatar_color, otherUser: publicUser(other) } };
  });

  // ---- message history (with reactions + reply previews) ----
  app.get('/api/messages', { preHandler: [auth] }, async (req) => {
    const channel = (req.query.channel || 'global').toString();
    const n = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
    const before = req.query.before ? parseInt(req.query.before, 10) : null;
    let rows;
    if (before && !Number.isNaN(before)) {
      rows = all(
        `SELECT m.*, u.name as author_name, u.avatar_color as author_color, u.role as author_role
         FROM messages m JOIN users u ON u.id = m.author_id
         WHERE m.channel_id = ? AND m.created_at < ?
         ORDER BY m.created_at DESC LIMIT ?`, [channel, before, n]
      );
    } else {
      rows = all(
        `SELECT m.*, u.name as author_name, u.avatar_color as author_color, u.role as author_role
         FROM messages m JOIN users u ON u.id = m.author_id
         WHERE m.channel_id = ? ORDER BY m.created_at DESC LIMIT ?`, [channel, n]
      );
    }
    rows.reverse();
    return { messages: rows.map(m => mapMessage(m, req.user.id)) };
  });

  // ---- send (REST path for polling transport) ----
  app.post('/api/chat/send', { preHandler: [auth] }, async (req, reply) => {
    const { channel = 'global', text, replyTo } = req.body || {};
    if (!text || !text.trim()) return reply.code(400).send({ error: 'empty' });
    const msg = app.hub.persistMessage(req.user, channel, text.trim(), replyTo || null);
    app.hub.broadcastMessage(msg, req.user);
    return { ok: true, message: msg };
  });

  // ---- edit own message (admins can edit any) ----
  app.patch('/api/messages/:id', { preHandler: [auth] }, async (req, reply) => {
    const m = get('SELECT * FROM messages WHERE id = ?', [req.params.id]);
    if (!m) return reply.code(404).send({ error: 'Message not found' });
    const mine = m.author_id === req.user.id;
    const admin = req.user.role === 'owner' || req.user.role === 'admin';
    if (!mine && !admin) return reply.code(403).send({ error: 'You can only edit your own messages' });
    const { text } = req.body || {};
    if (!text || !text.trim()) return reply.code(400).send({ error: 'Text required' });
    run('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?', [text.trim(), Date.now(), m.id]);
    const updated = hydrate(get('SELECT * FROM messages WHERE id = ?', [m.id]), req.user.id);
    app.hub.emitToChannel(m.channel_id, { type: 'message:edited', message: updated });
    return { message: updated };
  });

  // ---- delete own message (admins can delete any) ----
  app.delete('/api/messages/:id', { preHandler: [auth] }, async (req, reply) => {
    const m = get('SELECT * FROM messages WHERE id = ?', [req.params.id]);
    if (!m) return reply.code(404).send({ error: 'Message not found' });
    const mine = m.author_id === req.user.id;
    const admin = req.user.role === 'owner' || req.user.role === 'admin';
    if (!mine && !admin) return reply.code(403).send({ error: 'You can only delete your own messages' });
    run('DELETE FROM messages WHERE id = ?', [m.id]);
    app.hub.emitToChannel(m.channel_id, { type: 'message:deleted', id: m.id, channel: m.channel_id });
    return { ok: true };
  });

  // ---- toggle a reaction ----
  app.post('/api/messages/:id/react', { preHandler: [auth] }, async (req, reply) => {
    const m = get('SELECT * FROM messages WHERE id = ?', [req.params.id]);
    if (!m) return reply.code(404).send({ error: 'Message not found' });
    const emoji = (req.body?.emoji || '').trim().slice(0, 8);
    if (!emoji) return reply.code(400).send({ error: 'emoji required' });
    const existing = get('SELECT 1 as x FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [m.id, req.user.id, emoji]);
    let added;
    if (existing) {
      run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [m.id, req.user.id, emoji]);
      added = false;
    } else {
      run('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?,?,?,?)', [m.id, req.user.id, emoji, Date.now()]);
      added = true;
    }
    app.hub.emitToChannel(m.channel_id, {
      type: 'reaction', messageId: m.id, emoji, added, userId: req.user.id, channel: m.channel_id
    });
    return { added };
  });

  // ---- mark channel read ----
  app.post('/api/channels/read', { preHandler: [auth] }, async (req) => {
    const channel = (req.body?.channel || 'global').toString();
    run(`INSERT INTO channel_reads (channel_id, user_id, last_read_at) VALUES (?,?,?)
         ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
      [channel, req.user.id, Date.now()]);
    return { ok: true };
  });

  // ---- search messages (optionally scoped to a channel) ----
  app.get('/api/chat/search', { preHandler: [auth] }, async (req) => {
    const q = (req.query.q || '').toString().trim();
    if (q.length < 2) return { results: [] };
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    const rows = all(
      `SELECT m.*, u.name as author_name, u.avatar_color as author_color, u.role as author_role
       FROM messages m JOIN users u ON u.id = m.author_id
       WHERE m.text LIKE ? ${req.query.channel ? 'AND m.channel_id = ?' : ''}
       ORDER BY m.created_at DESC LIMIT 40`,
      req.query.channel ? [like, req.query.channel] : [like]
    );
    return { results: rows.map(m => mapMessage(m, req.user.id)) };
  });
}

// Attach reactions + reply preview to a raw message row
function hydrate(m, meId) {
  const reactions = all(
    `SELECT emoji, COUNT(*) as count, GROUP_CONCAT(user_id) as users
     FROM reactions WHERE message_id = ? GROUP BY emoji`, [m.id]
  );
  let replyTo = null;
  if (m.reply_to) {
    const r = get(
      `SELECT m.id, m.text, m.author_id, u.name as author_name
       FROM messages m JOIN users u ON u.id = m.author_id WHERE m.id = ?`, [m.reply_to]
    );
    if (r) replyTo = { id: r.id, text: r.text.slice(0, 140), authorName: r.author_name };
  }
  return {
    id: m.id, channel: m.channel_id, text: m.text, replyTo,
    createdAt: m.created_at, editedAt: m.edited_at || null,
    reactions: reactions.map(r => ({
      emoji: r.emoji, count: r.count, mine: (r.users || '').split(',').includes(meId)
    })),
    author: { id: m.author_id, name: m.author_name, avatarColor: m.author_color, role: m.author_role },
  };
}

function mapMessage(m, meId) {
  return hydrate(m, meId);
}
