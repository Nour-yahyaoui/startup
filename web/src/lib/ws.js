import { getToken } from './api.js';

export class RealtimeClient {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.reconnectTimer = null;
    this.subscribed = new Set();
    this.authed = false;
    this.queue = [];
    this.closedByUser = false;
  }

  connect() {
    this.closedByUser = false;
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      const token = getToken();
      if (this.closedByUser || !token) return ws.close();
      // Wait for auth:ok before sending subscriptions or queued actions.
      ws.send(JSON.stringify({ type: 'auth', token }));
    };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'auth:ok') {
        this.authed = true;
        for (const channel of this.subscribed) this.sendNow({ type: 'subscribe', channel });
        for (const queued of this.queue.splice(0)) this.sendNow(queued);
      } else if (msg.type === 'auth:error') {
        this.queue = [];
      }
      this.emit(msg.type, msg);
      this.emit('*', msg);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.authed = false;
      this.emit('close', event);
      clearTimeout(this.reconnectTimer);
      // Invalid/expired sessions do not reconnect forever.
      if (!this.closedByUser && event.code !== 4001 && getToken()) {
        this.reconnectTimer = setTimeout(() => this.connect(), 1500);
      }
    };
    ws.onerror = () => ws.close();
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) { this.handlers.get(type)?.delete(fn); }
  emit(type, data) { this.handlers.get(type)?.forEach(fn => fn(data)); }

  sendNow(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  send(msg) {
    if (!this.authed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.queue.push(msg);
    } else this.sendNow(msg);
  }
  subscribe(channel) {
    if (this.subscribed.has(channel)) return;
    this.subscribed.add(channel);
    if (this.authed) this.sendNow({ type: 'subscribe', channel });
  }
  unsubscribe(channel) {
    this.subscribed.delete(channel);
    if (this.authed) this.sendNow({ type: 'unsubscribe', channel });
  }
  sendChat(channel, text, replyTo) { this.send({ type: 'chat:send', channel, text, replyTo }); }
  typing(channel, isTyping) { this.send({ type: 'typing', channel, isTyping }); }
  close() {
    this.closedByUser = true;
    clearTimeout(this.reconnectTimer);
    this.queue = [];
    this.subscribed.clear();
    this.authed = false;
    if (this.ws) this.ws.close();
  }
}

export const rt = new RealtimeClient();
