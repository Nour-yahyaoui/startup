import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Icon } from '../components/Icons.jsx';
import { Avatar } from './Dashboard.jsx';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { formatTime } from '../lib/util.js';

export default function Chat() {
  const { rt, activeChannel, setActiveChannel, user, onlineUsers, can, toast } = useApp();
  const [channels, setChannels] = useState([]);
  const [channelQuery, setChannelQuery] = useState('');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [typingUsers, setTypingUsers] = useState(new Set());
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimeout = useRef(null);
  const channelsVersion = useRef(0);
  const messagesVersion = useRef(0);

  const loadChannels = useCallback(async () => {
    const version = ++channelsVersion.current;
    try {
      const result = await api.get('/api/channels');
      if (version !== channelsVersion.current) return;
      setChannels(result.channels);
      setActiveChannel(current => result.channels.some(channel => channel.id === current) ? current : 'global');
    } catch (e) { if (version === channelsVersion.current) toast(e.message, 'error'); }
  }, [setActiveChannel, toast]);

  useEffect(() => {
    loadChannels();
    const offs = ['project:create', 'project:update', 'project:delete', 'project:access-revoked', 'project:membership-changed'].map(type => rt.on(type, loadChannels));
    return () => { channelsVersion.current++; offs.forEach(off => off()); };
  }, [loadChannels, rt, user.role]);

  // Wait for the authenticated socket handshake and fetch only permitted history.
  useEffect(() => {
    if (!activeChannel) return;
    let active = true;
    const version = ++messagesVersion.current;
    rt.subscribe(activeChannel);
    setMessages([]); setTypingUsers(new Set());
    api.get(`/api/messages?channel=${encodeURIComponent(activeChannel)}`).then(result => {
      if (!active || version !== messagesVersion.current) return;
      setMessages(current => {
        const merged = new Map([...result.messages, ...current].map(message => [message.id, message]));
        return [...merged.values()].sort((a, b) => a.createdAt - b.createdAt);
      });
    }).catch(e => {
      if (!active || version !== messagesVersion.current) return;
      if (e.status === 404) setActiveChannel('global');
      else toast(e.message, 'error');
    });
    return () => { active = false; messagesVersion.current++; clearTimeout(typingTimeout.current); rt.unsubscribe(activeChannel); };
  }, [activeChannel, rt, setActiveChannel, toast]);

  useEffect(() => {
    const removeProject = ev => {
      if (activeChannel !== 'project:' + ev.projectId) return;
      messagesVersion.current++;
      setMessages([]); setTypingUsers(new Set()); setActiveChannel('global');
    };
    const off1 = rt.on('project:access-revoked', removeProject);
    const off2 = rt.on('project:delete', removeProject);
    return () => { off1(); off2(); };
  }, [rt, activeChannel, setActiveChannel]);

  // Realtime message + typing events
  useEffect(() => {
    const off1 = rt.on('chat:message', (ev) => {
      if (ev.message.channel === activeChannel) {
        setMessages(m => m.some(message => message.id === ev.message.id) ? m : [...m, ev.message]);
      }
    });
    const off2 = rt.on('typing', (ev) => {
      if (ev.channel !== activeChannel) return;
      if (ev.user.id === user.id) return;
      setTypingUsers(t => {
        const n = new Set(t);
        if (ev.isTyping) n.add(ev.user.id); else n.delete(ev.user.id);
        return n;
      });
    });
    return () => { off1(); off2(); };
  }, [rt, activeChannel, user.id]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typingUsers.size]);

  const send = (e) => {
    e.preventDefault();
    if (!text.trim() || !can('chat.write')) return;
    rt.sendChat(activeChannel, text.trim());
    setText('');
    inputRef.current?.focus();
  };

  const onType = (v) => {
    setText(v);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    rt.typing(activeChannel, true);
    typingTimeout.current = setTimeout(() => rt.typing(activeChannel, false), 1500);
  };

  const activeCh = channels.find(c => c.id === activeChannel);
  const typingDisplay = useMemo(() =>
    [...typingUsers].map(id => {
      const u = onlineUsers.get(id);
      return u ? u.name.split(' ')[0] : 'someone';
    }), [typingUsers, onlineUsers]);

  // Group messages by day and author
  const grouped = useMemo(() => {
    const groups = [];
    for (const m of messages) {
      const last = groups[groups.length - 1];
      const near = last && last.author.id === m.author.id && (m.createdAt - last.messages[last.messages.length - 1].createdAt) < 5 * 60 * 1000;
      if (near) last.messages.push(m);
      else groups.push({ author: m.author, messages: [m] });
    }
    return groups;
  }, [messages]);

  return (
    <div className="h-[calc(100vh-3.5rem)] flex">
      {/* Channel sidebar */}
      <aside className="w-32 sm:w-64 border-r border-border flex flex-col shrink-0">
        <div className="p-3">
          <div className="relative">
            <Icon name="search" size={16} className="absolute left-2.5 top-2.5 text-muted" />
            <input className="input !pl-8" placeholder="Search channels…" aria-label="Search channels" value={channelQuery} onChange={e => setChannelQuery(e.target.value)} />
          </div>
        </div>
        <div className="px-3 text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">Channels</div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {channels.filter(ch => ch.name.toLowerCase().includes(channelQuery.toLowerCase())).map(ch => (
            <button
              key={ch.id}
              onClick={() => setActiveChannel(ch.id)}
              className={`sidebar-item w-full ${activeChannel === ch.id ? 'active' : ''}`}
            >
              {ch.kind === 'global'
                ? <Icon name="hash" size={16} />
                : <span className="w-2 h-2 rounded-full" style={{ background: ch.color }} />}
              <span className="flex-1 truncate text-left">{ch.name}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Main chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-14 border-b border-border px-5 flex items-center gap-3 shrink-0">
          {activeCh?.kind === 'global' ? <Icon name="hash" size={18} /> : <span className="w-3 h-3 rounded-full" style={{ background: activeCh?.color }} />}
          <div>
            <div className="font-semibold text-sm">#{activeCh?.name || 'general'}</div>
            <div className="text-xs text-muted">{activeCh?.kind === 'project' ? 'Private to project members and admins' : 'Visible to the workspace'} · {messages.length} messages</div>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted">
              <Icon name="chat" size={32} className="mb-3 opacity-50" />
              <div className="font-medium text-fg">This is the start of #{activeCh?.name}</div>
              <div className="text-sm">Say hi to kick things off.</div>
            </div>
          )}
          {grouped.map((g, i) => (
            <div key={i} className="flex gap-3">
              <Avatar user={g.author} size={36} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-sm">{g.author.name}</span>
                  <span className="text-[11px] text-muted">{formatTime(g.messages[0].createdAt)}</span>
                  {g.author.role !== 'employee' && (
                    <span className="chip !py-0 !text-[10px] capitalize">{g.author.role}</span>
                  )}
                </div>
                <div className="space-y-1 mt-0.5">
                  {g.messages.map(m => (
                    <div key={m.id} className="text-[14.5px] leading-snug break-words whitespace-pre-wrap">{m.text}</div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {typingDisplay.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="dots"><span/><span/><span/></span>
              <span>{typingDisplay.join(', ')} {typingDisplay.length === 1 ? 'is' : 'are'} typing…</span>
            </div>
          )}
        </div>

        {/* Composer */}
        {can('chat.write') ? <form onSubmit={send} className="p-4 border-t border-border">
          <div className="flex items-end gap-2 card p-2 pl-3">
            <button type="button" className="btn-ghost !p-1.5" title="Attach file"><Icon name="paperclip" size={18} /></button>
            <button type="button" className="btn-ghost !p-1.5" title="Emoji"><Icon name="smile" size={18} /></button>
            <textarea
              ref={inputRef}
              value={text}
              onChange={e => onType(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }}
              placeholder={`Message #${activeCh?.name || 'general'}`}
              rows={1}
              className="flex-1 bg-transparent resize-none outline-none text-sm py-2 max-h-32"
              style={{ minHeight: 28 }}
            />
            <button type="submit" disabled={!text.trim()} className="btn-primary !p-2 disabled:opacity-40">
              <Icon name="send" size={16} />
            </button>
          </div>
          <div className="text-[11px] text-muted mt-2 px-1">Press <span className="kbd">Enter</span> to send · <span className="kbd">Shift+Enter</span> for newline</div>
        </form> : <div className="p-4 border-t border-border text-sm text-muted">Your role has read-only access to chat.</div>}
      </div>
    </div>
  );
}
