import React, { useEffect, useRef, useState, createContext, useContext, useCallback } from 'react';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { api, getToken, clearToken, setToken, getStoredUser, setStoredUser, clearStoredUser } from './lib/api.js';
import { rt } from './lib/ws.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export default function App() {
  const [user, setUser] = useState(getStoredUser());
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('nexa_theme') || 'dark');
  const [page, setPage] = useState('home'); // home | chat | projects | files | team | settings
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [activeChannel, setActiveChannel] = useState('global');
  const [toasts, setToasts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const unreadCount = notifications.filter(n => !n.read).length;
  const notificationsVersion = useRef(0);
  const [onlineUsers, setOnlineUsers] = useState(new Map());
  const [permissions, setPermissions] = useState([]);

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('nexa_theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), []);

  const toast = useCallback((msg, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  // Session boot: validate token
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getToken();
      if (token) {
        try {
          const me = await api.get('/api/auth/me');
          if (!cancelled) setUser(me.user);
        } catch {
          clearToken(); clearStoredUser(); setUser(null);
        }
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Connect WS after auth
  useEffect(() => {
    if (!user) return;
    rt.connect();
    const off1 = rt.on('auth:ok', () => { rt.subscribe('global'); });
    const off2 = rt.on('notification', (ev) => {
      const n = { id: ev.notification.id, kind: ev.notification.type, title: ev.notification.title, body: ev.notification.body, createdAt: ev.notification.createdAt, projectId: ev.notification.projectId, read: false };
      setNotifications(ns => [n, ...ns].slice(0, 100));
      toast(n.title, 'info');
    });
    const off3 = rt.on('presence', (ev) => {
      setOnlineUsers(m => {
        const n = new Map(m);
        if (ev.online) n.set(ev.userId, ev.user); else n.delete(ev.userId);
        return n;
      });
    });
    const off4 = rt.on('presence:roster', (ev) => {
      const m = new Map();
      for (const u of ev.users) m.set(u.id, u);
      setOnlineUsers(m);
    });
    const off5 = rt.on('user:join', (ev) => toast(`${ev.user.name} joined the team`, 'success'));
    const off6 = rt.on('file:new', (ev) => toast(`${ev.uploader.name} uploaded ${ev.file.name}`, 'info'));
    const off7 = rt.on('project:create', () => toast('New project created', 'success'));
    const off8 = rt.on('user:update', (ev) => {
      if (ev.user.id !== user.id) return;
      setStoredUser(ev.user);
      setUser(ev.user);
      if (ev.user.role !== user.role) {
        notificationsVersion.current++;
        setNotifications(ns => ns.filter(n => !n.projectId));
        setPage('home'); setActiveProjectId(null); setActiveChannel('global');
        toast('Your workspace role has changed', 'info');
      }
    });
    const off9 = rt.on('error', ev => toast(ev.message || 'Realtime request failed', 'error'));
    const off10 = rt.on('close', ev => {
      if (ev.code !== 4001) return;
      clearToken(); clearStoredUser(); setUser(null); rt.close();
      notificationsVersion.current++; setNotifications([]); setOnlineUsers(new Map());
      setPage('home'); setActiveProjectId(null); setActiveChannel('global');
      toast('Your session ended. Please sign in again.', 'info');
    });
    return () => { off1(); off2(); off3(); off4(); off5(); off6(); off7(); off8(); off9(); off10(); };
  }, [user, toast]);

  // A membership change takes effect immediately, including in open views.
  useEffect(() => {
    if (!user) return;
    const leaveProject = ({ projectId }) => {
      rt.unsubscribe('project:' + projectId);
      if (activeProjectId === projectId) {
        setActiveProjectId(null); setPage('projects');
        toast('This project is no longer available to you.', 'info');
      }
      if (activeChannel === 'project:' + projectId) setActiveChannel('global');
      notificationsVersion.current++;
      setNotifications(ns => ns.filter(n => n.projectId !== projectId));
    };
    const off1 = rt.on('project:access-revoked', leaveProject);
    const off2 = rt.on('project:delete', leaveProject);
    return () => { off1(); off2(); };
  }, [user, activeProjectId, activeChannel, toast]);

  // The server remains authoritative; these permissions only tailor controls in the UI.
  useEffect(() => {
    if (!user) { setPermissions([]); return; }
    let active = true;
    const loadPermissions = async () => {
      try {
        const { roles } = await api.get('/api/roles');
        const found = roles.find(role => role.name === user.role);
        const parsed = JSON.parse(found?.permissions || '[]');
        if (active) setPermissions(Array.isArray(parsed) ? parsed : []);
      } catch { if (active) setPermissions([]); }
    };
    loadPermissions();
    const off = rt.on('role:update', ev => { if (ev.name === user.role) loadPermissions(); });
    return () => { active = false; off(); };
  }, [user?.id, user?.role]);

  // Fetch notifications on auth
  useEffect(() => {
    if (!user) return;
    const version = ++notificationsVersion.current;
    api.get('/api/notifications').then(n => {
      if (version !== notificationsVersion.current) return;
      const stored = n.notifications.map(x => ({ ...x, projectId: x.payload.projectId, read: !!x.readAt, kind: x.type, title: x.payload.title || x.type, body: x.payload.body || '' }));
      setNotifications(current => {
        const merged = new Map([...stored, ...current].map(item => [item.id, item]));
        return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
      });
    }).catch(()=>{});
    return () => { notificationsVersion.current++; };
  }, [user]);

  const login = async (email, password) => {
    const r = await api.post('/api/auth/login', { email, password });
    setToken(r.token); setStoredUser(r.user); setUser(r.user);
  };
  const register = async (email, name, password) => {
    const r = await api.post('/api/auth/register', { email, name, password });
    setToken(r.token); setStoredUser(r.user); setUser(r.user);
  };
  const logout = () => {
    clearToken(); clearStoredUser(); setUser(null);
    rt.close();
    notificationsVersion.current++; setNotifications([]); setOnlineUsers(new Map());
    setPage('home'); setActiveChannel('global'); setActiveProjectId(null);
  };

  const markAllRead = async () => {
    await api.post('/api/notifications/read-all', {});
    setNotifications(ns => ns.map(n => ({ ...n, read: true })));
  };

  const ctx = {
    user, login, register, logout, ready,
    can: permission => user?.role === 'owner' || user?.role === 'admin' || permissions.includes('*') || permissions.includes(permission),
    theme, toggleTheme,
    page, setPage,
    activeProjectId, setActiveProjectId,
    activeChannel, setActiveChannel,
    toasts, toast,
    notifications, setNotifications, unreadCount, markAllRead,
    onlineUsers, rt
  };

  if (!ready) {
    return <div className="h-full flex items-center justify-center text-muted">Loading Nexa…</div>;
  }

  return (
    <AppCtx.Provider value={ctx}>
      {!user ? <Login /> : <Dashboard />}
      <ToastContainer toasts={toasts} />
    </AppCtx.Provider>
  );
}

function ToastContainer({ toasts }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`pointer-events-auto animate-fade-in card px-4 py-3 text-sm max-w-sm
          ${t.kind === 'error' ? 'border-danger/40' : t.kind === 'success' ? 'border-success/40' : ''}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
