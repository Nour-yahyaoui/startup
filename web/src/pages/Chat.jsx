import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Icon } from '../components/Icons.jsx';
import { Avatar } from './Dashboard.jsx';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { formatTime, initials } from '../lib/util.js';

const QUICK_EMOJI = ['👍', '🎉', '❤️', '😂', '👀', '🚀'];

export default function Chat() {
  const { rt, activeChannel, setActiveChannel, user, onlineUsers, users, toast } = useApp();
  const [channels, setChannels] = useState([]);
  const [previews, setPreviews] = useState({});
  const [unread, setUnread] = useState({});
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [text, setText] = useState('');
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [channelFilter, setChannelFilter] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [replyTo, setReplyTo] = useState(null);       // {id, text, authorName}
  const [editing, setEditing] = useState(null);        // {id, text}
  const [menuFor, setMenuFor] = useState(null);        // message id with open hover menu
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimeout = useRef(null);

  const isAdmin = user.role === 'owner' || user.role === 'admin';

  // ---- channel list (with unread counts) ----
  const loadChannels = useCallback(() => {
    api.get('/api/channels').then(r => {
      setChannels(r.channels);
      setPreviews(r.previews || {});
      setUnread(r.unread || {});
    }).catch(() => {});
  }, []);
  useEffect(() => { loadChannels(); }, [loadChannels]);

  // ---- load + subscribe active channel ----
  const loadMessages = useCallback((ch) => {
    setLoading(true);
    setLoadError(null);
    api.get(`/api/messages?channel=${encodeURIComponent(ch)}`)
      .then(r => { setMessages(r.messages); setLoading(false); markRead(ch); })
      .catch(() => { setLoading(false); setLoadError("We couldn't load this channel's history. Nothing you sent was lost."); });
  }, []);
  useEffect(() => {
    if (!activeChannel) return;
    rt.subscribe(activeChannel);
    setMessages([]);
    loadMessages(activeChannel);
    return () => rt.unsubscribe(activeChannel);
  }, [activeChannel, rt, loadMessages]);

  const markRead = useCallback((ch) => {
    api.post('/api/channels/read', { channel: ch }).then(() => setUnread(u => ({ ...u, [ch]: 0 }))).catch(() => {});
  }, []);

  // ---- realtime events ----
  useEffect(() => {
    const offMsg = rt.on('chat:message', (ev) => {
      const m = ev.message;
      if (m.channel === activeChannel) {
        setMessages(list => list.some(x => x.id === m.id) ? list : [...list, m]);
        markRead(m.channel);
      }
      setPreviews(p => ({ ...p, [m.channel]: m }));
      if (m.channel !== activeChannel) setUnread(u => ({ ...u, [m.channel]: (u[m.channel] || 0) + 1 }));
    });
    const offTyping = rt.on('typing', (ev) => {
      if (ev.channel !== activeChannel || ev.user.id === user.id) return;
      setTypingUsers(t => {
        const n = new Set(t);
        if (ev.isTyping) n.add(ev.user.id); else n.delete(ev.user.id);
        return n;
      });
    });
    const offEdited = rt.on('message:edited', (ev) => {
      if (ev.message.channel !== activeChannel) return;
      setMessages(list => list.map(m => m.id === ev.message.id ? ev.message : m));
    });
    const offDeleted = rt.on('message:deleted', (ev) => {
      if (ev.channel !== activeChannel) return;
      setMessages(list => list.filter(m => m.id !== ev.id));
    });
    const offReact = rt.on('reaction', (ev) => {
      if (ev.channel !== activeChannel) return;
      setMessages(list => list.map(m => {
        if (m.id !== ev.messageId) return m;
        const rs = (m.reactions || []).map(r => ({ ...r }));
        const hit = rs.find(r => r.emoji === ev.emoji);
        if (hit) {
          hit.count += ev.added ? 1 : -1;
          if (ev.userId === user.id) hit.mine = ev.added;
          if (hit.count <= 0) return { ...m, reactions: rs.filter(r => r.count > 0) };
        } else if (ev.added) {
          rs.push({ emoji: ev.emoji, count: 1, mine: ev.userId === user.id });
        }
        return { ...m, reactions: rs };
      }));
    });
    return () => { offMsg(); offTyping(); offEdited(); offDeleted(); offReact(); };
  }, [rt, activeChannel, user.id, markRead]);

  // Auto-scroll (preserve position when loading older, jump on new)
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typingUsers.size]);

  const send = (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    if (editing) {
      api.patch(`/api/messages/${editing.id}`, { text: body })
        .then(({ message }) => {
          setMessages(list => list.map(m => m.id === editing.id ? message : m));
          setEditing(null); setText('');
        })
        .catch(err => toast(err.message || "The edit didn't save — try again.", 'error'));
      return;
    }
    rt.sendChat(activeChannel, body, replyTo?.id);
    setText(''); setReplyTo(null);
    inputRef.current?.focus();
  };

  const onType = (v) => {
    setText(v);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    rt.typing(activeChannel, true);
    typingTimeout.current = setTimeout(() => rt.typing(activeChannel, false), 1500);
  };

  const startEdit = (m) => {
    setEditing({ id: m.id, text: m.text });
    setText(m.text);
    setReplyTo(null);
    inputRef.current?.focus();
  };

  const deleteMsg = (m) => {
    api.del(`/api/messages/${m.id}`)
      .then(() => setMessages(list => list.filter(x => x.id !== m.id)))
      .catch(() => toast("The message is still there — deleting failed. Try again.", 'error'));
  };

  const react = (m, emoji) => {
    // optimistic
    setMessages(list => list.map(x => {
      if (x.id !== m.id) return x;
      const rs = (x.reactions || []).map(r => ({ ...r }));
      const hit = rs.find(r => r.emoji === emoji);
      if (hit?.mine) { hit.count--; return { ...x, reactions: rs.filter(r => r.count > 0) }; }
      if (hit) { hit.count++; hit.mine = true; return { ...x, reactions: rs }; }
      return { ...x, reactions: [...rs, { emoji, count: 1, mine: true }] };
    }));
    api.post(`/api/messages/${m.id}/react`, { emoji }).catch(() => loadMessages(activeChannel));
    setMenuFor(null);
  };

  const startDm = (u) => {
    api.post('/api/chat/dm', { userId: u.id }).then(({ channel }) => {
      loadChannels();
      setActiveChannel(channel.id);
    }).catch(err => toast(err.message || "Couldn't open that conversation.", 'error'));
  };

  const runSearch = (e) => {
    e?.preventDefault();
    const q = searchQ.trim();
    if (q.length < 2) { setSearchResults(null); return; }
    api.get(`/api/chat/search?q=${encodeURIComponent(q)}&channel=${encodeURIComponent(activeChannel)}`)
      .then(r => setSearchResults(r.results))
      .catch(() => toast('Search is unavailable right now.', 'error'));
  };

  const activeCh = channels.find(c => c.id === activeChannel);
  const channelName = activeCh?.name || (activeChannel.startsWith('dm:') ? 'Direct message' : 'general');
  const typingDisplay = useMemo(() =>
    [...typingUsers].map(id => onlineUsers.get(id)?.name?.split(' ')[0] || 'someone'), [typingUsers, onlineUsers]);

  const visibleChannels = channels.filter(c => c.name?.toLowerCase().includes(channelFilter.toLowerCase()));
  const dmChannels = visibleChannels.filter(c => c.kind === 'dm');
  const roomChannels = visibleChannels.filter(c => c.kind !== 'dm');
  // people not in an existing DM
  const dmOtherIds = new Set(dmChannels.map(c => c.otherUser?.id));
  const dmCandidates = (users || []).filter(u => u.id !== user.id && !dmOtherIds.has(u.id));

  // Group messages by author runs
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

  const canModerate = (m) => m.author.id === user.id || isAdmin;

  return (
    <div className="h-[calc(100vh-3.5rem)] flex">
      {/* Channel sidebar */}
      <aside className="w-64 border-r border-border flex flex-col shrink-0">
        <div className="p-3 space-y-2">
          <div className="relative">
            <Icon name="search" size={16} className="absolute left-2.5 top-2.5 text-muted" />
            <input className="input !pl-8" placeholder="Filter channels…" value={channelFilter} onChange={e => setChannelFilter(e.target.value)} />
          </div>
          <div className="relative">
            <Icon name="search" size={16} className="absolute left-2.5 top-2.5 text-muted" />
            <form onSubmit={runSearch}>
              <input className="input !pl-8" placeholder="Search in channel…" value={searchQ}
                onChange={e => { setSearchQ(e.target.value); if (!e.target.value) setSearchResults(null); }} />
            </form>
          </div>
        </div>

        <div className="px-3 text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">Channels</div>
        <div className="overflow-y-auto px-2 pb-3 flex-1">
          {roomChannels.map(ch => (
            <button key={ch.id} onClick={() => { setActiveChannel(ch.id); setSearchResults(null); }}
              className={`sidebar-item w-full ${activeChannel === ch.id ? 'active' : ''}`}>
              {ch.kind === 'global' ? <Icon name="hash" size={16} /> : <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ch.color }} />}
              <span className="flex-1 truncate text-left">{ch.name}</span>
              {unread[ch.id] > 0 && <span className="badge-unread">{unread[ch.id] > 99 ? '99+' : unread[ch.id]}</span>}
            </button>
          ))}

          <div className="px-2 pt-3 pb-1 text-[11px] uppercase tracking-wide text-muted font-semibold">Direct messages</div>
          {dmChannels.map(ch => (
            <button key={ch.id} onClick={() => { setActiveChannel(ch.id); setSearchResults(null); }}
              className={`sidebar-item w-full ${activeChannel === ch.id ? 'active' : ''}`}>
              <span className="relative">
                <Avatar user={ch.otherUser || { name: ch.name, avatarColor: ch.color }} size={18} />
                {onlineUsers.has(ch.otherUser?.id) && <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-success border border-surface" />}
              </span>
              <span className="flex-1 truncate text-left">{ch.name}</span>
              {unread[ch.id] > 0 && <span className="badge-unread">{unread[ch.id] > 99 ? '99+' : unread[ch.id]}</span>}
            </button>
          ))}
          {dmCandidates.filter(u => u.name?.toLowerCase().includes(channelFilter.toLowerCase())).map(u => (
            <button key={u.id} onClick={() => startDm(u)} className="sidebar-item w-full text-muted hover:text-fg">
              <Avatar user={u} size={18} />
              <span className="flex-1 truncate text-left">{u.name}</span>
              <Icon name="plus" size={12} />
            </button>
          ))}
          {dmChannels.length === 0 && dmCandidates.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted">Invite teammates from the Team page to start a direct message.</div>
          )}
        </div>
      </aside>

      {/* Main chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-14 border-b border-border px-5 flex items-center gap-3 shrink-0">
          {activeCh?.kind === 'dm'
            ? <Avatar user={activeCh.otherUser || { name: channelName, avatarColor: activeCh.color }} size={26} />
            : activeCh?.kind === 'global' ? <Icon name="hash" size={18} />
            : <span className="w-3 h-3 rounded-full" style={{ background: activeCh?.color }} />}
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">
              {activeCh?.kind !== 'global' ? '' : '#'}{channelName}
            </div>
            <div className="text-xs text-muted">
              {activeCh?.kind === 'dm'
                ? (onlineUsers.has(activeCh.otherUser?.id) ? 'online' : 'offline') + ' · direct message'
                : `${messages.length} messages · realtime`}
            </div>
          </div>
          {searchResults && (
            <button onClick={() => { setSearchResults(null); setSearchQ(''); }} className="btn-ghost !text-xs ml-auto">
              <Icon name="x" size={14}/> Clear search
            </button>
          )}
        </div>

        {/* Messages / search results */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading && (
            <div className="space-y-5" aria-busy="true">
              {[42, 30, 55].map((w, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-9 h-9 rounded-full bg-surface2 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 rounded bg-surface2 animate-pulse" style={{ width: `${w}%` }} />
                    <div className="h-3 rounded bg-surface2 animate-pulse" style={{ width: '70%' }} />
                  </div>
                </div>
              ))}
              <div className="text-xs text-muted text-center">Loading messages…</div>
            </div>
          )}

          {!loading && loadError && (
            <div className="card border-danger/40 p-4 flex items-center justify-between gap-3">
              <span className="text-sm">{loadError}</span>
              <button className="btn-outline !py-1.5 !text-xs" onClick={() => loadMessages(activeChannel)}>Retry</button>
            </div>
          )}

          {!loading && !loadError && searchResults && (
            <div className="space-y-3">
              <div className="text-xs text-muted">{searchResults.length} result{searchResults.length === 1 ? '' : 's'} for “{searchQ}”</div>
              {searchResults.length === 0 && (
                <div className="text-sm text-muted">Nothing matches “{searchQ}” in this channel. Check the spelling, or try a broader term.</div>
              )}
              {searchResults.map(m => (
                <div key={m.id} className="flex gap-3">
                  <Avatar user={m.author} size={30} />
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-sm">{m.author.name}</span>
                      <span className="text-[11px] text-muted">{formatTime(m.createdAt)}</span>
                    </div>
                    <div className="text-sm break-words">{m.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && !loadError && !searchResults && messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted">
              <Icon name="chat" size={32} className="mb-3 opacity-50" />
              <div className="font-medium text-fg">This is the start of {activeCh?.kind === 'dm' ? 'your conversation' : `#${channelName}`}</div>
              <div className="text-sm">Say hi to kick things off.</div>
            </div>
          )}

          {!loading && !loadError && !searchResults && grouped.map((g, gi) => (
            <div key={gi} className="flex gap-3 group">
              <Avatar user={g.author} size={36} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-sm">{g.author.name}</span>
                  <span className="text-[11px] text-muted">{formatTime(g.messages[0].createdAt)}</span>
                  {g.author.role !== 'employee' && <span className="chip !py-0 !text-[10px] capitalize">{g.author.role}</span>}
                </div>
                <div className="space-y-1 mt-0.5">
                  {g.messages.map(m => (
                    <div key={m.id} className="relative">
                      <div className="text-[14.5px] leading-snug break-words whitespace-pre-wrap">
                        {m.replyTo && (
                          <div className="mb-1 pl-2 border-l-2 border-border text-xs text-muted truncate">
                            <span className="font-medium text-fg/80">{m.replyTo.authorName}</span> {m.replyTo.text}
                          </div>
                        )}
                        {m.text}
                        {m.editedAt && <span className="ml-1.5 text-[10px] text-muted">(edited)</span>}
                      </div>
                      {m.reactions?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {m.reactions.map(r => (
                            <button key={r.emoji} onClick={() => react(m, r.emoji)}
                              className={`chip !py-0 !text-xs ${r.mine ? '!border-primary/50 !text-fg' : ''}`}>
                              {r.emoji} {r.count}
                            </button>
                          ))}
                        </div>
                      )}
                      {/* hover actions */}
                      <div className="absolute -top-2 right-0 hidden group-hover:flex items-center gap-0.5 card !p-0.5">
                        {QUICK_EMOJI.slice(0, 3).map(e => (
                          <button key={e} onClick={() => react(m, e)} className="px-1 text-sm hover:scale-110 transition" title={`React ${e}`}>{e}</button>
                        ))}
                        <button onClick={() => { setReplyTo({ id: m.id, text: m.text, authorName: m.author.name }); setEditing(null); inputRef.current?.focus(); }}
                          className="p-1 text-muted hover:text-fg" title="Reply"><Icon name="reply" size={13} /></button>
                        {canModerate(m) && (
                          <>
                            <button onClick={() => startEdit(m)} className="p-1 text-muted hover:text-fg" title="Edit"><Icon name="edit" size={13} /></button>
                            <button onClick={() => deleteMsg(m)} className="p-1 text-muted hover:text-danger" title="Delete"><Icon name="trash" size={13} /></button>
                          </>
                        )}
                      </div>
                    </div>
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
        <form onSubmit={send} className="p-4 border-t border-border">
          {(replyTo || editing) && (
            <div className="flex items-center justify-between card !py-1.5 !px-3 mb-2 text-xs">
              <span className="text-muted truncate">
                {editing ? <>Editing message — <span className="text-fg">{editing.text.slice(0, 60)}</span></>
                         : <>Replying to <span className="text-fg">{replyTo.authorName}</span>: {replyTo.text.slice(0, 60)}</>}
              </span>
              <button type="button" className="btn-ghost !p-1" onClick={() => { setReplyTo(null); setEditing(null); if (editing) setText(''); }}>
                <Icon name="x" size={13}/>
              </button>
            </div>
          )}
          <div className="flex items-end gap-2 card p-2 pl-3">
            <textarea
              ref={inputRef}
              value={text}
              onChange={e => onType(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }}
              onKeyDownCapture={e => { if (e.key === 'Escape' && editing) { setEditing(null); setText(''); } }}
              placeholder={editing ? 'Edit your message…' : `Message ${activeCh?.kind === 'dm' ? channelName : '#' + channelName}`}
              rows={1}
              className="flex-1 bg-transparent resize-none outline-none text-sm py-2 max-h-32"
              style={{ minHeight: 28 }}
            />
            <button type="submit" disabled={!text.trim()} className="btn-primary !p-2 disabled:opacity-40" title={editing ? 'Save edit' : 'Send'}>
              <Icon name={editing ? 'check' : 'send'} size={16} />
            </button>
          </div>
          <div className="text-[11px] text-muted mt-2 px-1">
            <span className="kbd">Enter</span> to send · <span className="kbd">Shift+Enter</span> for newline{editing && <> · <span className="kbd">Esc</span> to cancel edit</>}
          </div>
        </form>
      </div>
    </div>
  );
}
