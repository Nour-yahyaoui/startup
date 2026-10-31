import { getToken } from './api.js';

// Picks the best transport available:
// - WebSocket on http(s)://host/ws (works locally and on any host that upgrades WS)
// - HTTP long-poll fallback (works on Vercel and any serverless host)
// Both expose the same on/emit/send interface used by App.jsx.

class WsTransport {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.reconnectTimer = null;
    this.subscribed = new Set();
    this.authed = false;
    this.queue = [];
  }
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      const token = getToken();
      if (token) this.send({ type: 'auth', token });
      for (const ch of this.subscribed) this.send({ type: 'subscribe', channel: ch });
      while (this.queue.length) this.send(this.queue.shift());
      this.emit('open');
    };
    this.ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      this.emit(msg.type, msg);
      this.emit('*', msg);
    };
    this.ws.onclose = () => {
      this.authed = false;
      // switch to polling after 2 failed reconnects
      this._failures = (this._failures || 0) + 1;
      if (this._failures >= 2 && !this._fallback) {
        console.info('[rt] WebSocket unavailable, switching to polling transport.');
        this._fallback = new PollTransport(this);
        this._fallback.connect();
        return;
      }
      this.emit('close');
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), 1500);
    };
    this.ws.onerror = () => { try { this.ws.close(); } catch {} };
  }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) { this.handlers.get(type)?.delete(fn); }
  emit(type, data) {
    const s = this.handlers.get(type);
    if (s) s.forEach(fn => fn(data));
    // bubble to fallback if any
    if (this._fallback && type !== '*') this._fallback._deliverLocal(data);
  }
  send(msg) {
    if (this._fallback) return this._fallback.send(msg);
    if (!this.ws || this.ws.readyState !== 1) { this.queue.push(msg); return; }
    this.ws.send(JSON.stringify(msg));
  }
  auth(token) { this.send({ type: 'auth', token }); }
  subscribe(channel) {
    this.subscribed.add(channel);
    if (this._fallback) this._fallback.subscribed.add(channel);
    this.send({ type: 'subscribe', channel });
  }
  unsubscribe(channel) {
    this.subscribed.delete(channel);
    this._fallback?.subscribed.delete(channel);
    this.send({ type: 'unsubscribe', channel });
  }
  sendChat(channel, text, replyTo) { this.send({ type: 'chat:send', channel, text, replyTo }); }
  typing(channel, isTyping) { this.send({ type: 'typing', channel, isTyping }); }
  close() { try { this.ws?.close(); } catch {} this._fallback?.close(); }
}

class PollTransport {
  constructor(parent) {
    this.parent = parent;
    this.subscribed = new Set(parent.subscribed);
    this.handlers = parent.handlers; // share handlers
    this.cursor = null;
    this._timer = null;
    this._authed = false;
  }
  connect() {
    this._authed = false;
    this.poll();
  }
  _deliverLocal(/*msg*/) { /* events we send ourselves flow via POST/REST, no loopback needed */ }
  emit(type, data) {
    const s = this.handlers.get(type);
    if (s) s.forEach(fn => fn(data));
  }
  on() { return this.parent.on(...arguments); }
  off() { return this.parent.off(...arguments); }
  async poll() {
    try {
      const token = getToken();
      if (!token) { this._timer = setTimeout(() => this.poll(), 2000); return; }
      if (!this._authed) {
        // Trigger an initial hello/auth path so UI transitions correctly
        try {
          const me = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer '+token } }).then(r=>r.json());
          if (me.user) {
            this.emit('auth:ok', { user: me.user });
            this.emit('presence:roster', { users: [me.user] });
            this._authed = true;
          }
        } catch {}
      }
      const url = `/api/poll?cursor=${this.cursor || ''}&token=${encodeURIComponent(token)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('poll failed');
      const { events, cursor } = await res.json();
      this.cursor = cursor;
      for (const ev of events) this.emit(ev.type, ev);
    } catch {}
    this._timer = setTimeout(() => this.poll(), 1500);
  }
  send(msg) {
    // Chat messages go over REST POST since we can't emit WS frames.
    if (msg.type === 'chat:send') {
      const token = getToken();
      fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer '+token },
        body: JSON.stringify({ channel: msg.channel, text: msg.text, replyTo: msg.replyTo })
      }).catch(()=>{});
    }
    // Other messages (auth, subscribe, typing) don't apply to polling
  }
  auth() { /* handled in poll() */ }
  subscribe(ch) { this.subscribed.add(ch); }
  unsubscribe(ch) { this.subscribed.delete(ch); }
  sendChat() { this.send({ type: 'chat:send', ...arguments[0] }); }
  typing() { /* no typing indicators in polling mode */ }
  close() { clearTimeout(this._timer); }
}

export const rt = new WsTransport();
