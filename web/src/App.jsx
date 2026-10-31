import React, { useEffect, useState, createContext, useContext, useCallback } from 'react';
import Login from './pages/Login.jsx';
import Landing from './pages/Landing.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { api, getToken, clearToken, setToken, getStoredUser, setStoredUser, clearStoredUser } from './lib/api.js';
import { rt } from './lib/ws.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

function useRoute() {
  const [route, setRoute] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const nav = useCallback((to) => { window.history.pushState({}, '', to); setRoute(to); window.scrollTo(0,0); }, []);
  return [route, nav];
}

export default function App() {
  const [user, setUser] = useState(getStoredUser());
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('teamroom_theme') ?? localStorage.getItem('nexa_theme') ?? 'dark');
  const [page, setPage] = useState('home');
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [activeChannel, setActiveChannel] = useState('global');
  const [toasts, setToasts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState(new Map());
  const [users, setUsers] = useState([]);
  const [route, nav] = useRoute();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('teamroom_theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), []);

  const toast = useCallback((msg, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getToken();
      if (token) {
        try {
          const me = await api.get('/api/auth/me');
          if (!cancelled) setUser(me.user);
        } catch { clearToken(); clearStoredUser(); setUser(null); }
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user) return;
    rt.connect();
    const offs = [];
    offs.push(rt.on('auth:ok', () => rt.subscribe('global')));
    offs.push(rt.on('notification', (ev) => {
      const n = { id: ev.notification.id, kind: ev.notification.type, title: ev.notification.title, body: ev.notification.body, createdAt: ev.notification.createdAt, read: false };
      setNotifications(ns => [n, ...ns].slice(0, 100));
      setUnreadCount(c => c + 1);
      toast(n.title, 'info');
    }));
    offs.push(rt.on('presence', (ev) => {
      setOnlineUsers(m => { const n = new Map(m); if (ev.online) n.set(ev.userId, ev.user); else n.delete(ev.userId); return n; });
    }));
    offs.push(rt.on('presence:roster', (ev) => {
      const m = new Map(); for (const u of ev.users) m.set(u.id, u); setOnlineUsers(m);
    }));
    offs.push(rt.on('user:join', (ev) => { toast(`${ev.user.name} joined the team`, 'success'); setUsers(us => us.some(u => u.id === ev.user.id) ? us : [...us, ev.user]); }));
    offs.push(rt.on('user:update', (ev) => setUsers(us => us.map(u => u.id === ev.user.id ? ev.user : u))));
    offs.push(rt.on('user:leave', (ev) => setUsers(us => us.filter(u => u.id !== ev.userId))));
    offs.push(rt.on('file:new', (ev) => toast(`${ev.uploader.name} uploaded ${ev.file.name}`, 'info')));
    offs.push(rt.on('project:create', () => toast('New project created', 'success')));
    return () => offs.forEach(f => f());
  }, [user, toast]);

  useEffect(() => {
    if (!user) return;
    api.get('/api/users').then(r => setUsers(r.users)).catch(() => {});
    api.get('/api/notifications').then(n => {
      setNotifications(n.notifications.map(x => ({ ...x, read: !!x.readAt, kind: x.type, title: x.payload.title || x.type, body: x.payload.body || '' })));
      setUnreadCount(n.notifications.filter(x => !x.readAt).length);
    }).catch(()=>{});
  }, [user]);

  const login = async (email, password) => {
    const r = await api.post('/api/auth/login', { email, password });
    setToken(r.token); setStoredUser(r.user); setUser(r.user);
    nav('/dashboard');
  };
  const register = async (email, name, password) => {
    const r = await api.post('/api/auth/register', { email, name, password });
    setToken(r.token); setStoredUser(r.user); setUser(r.user);
    nav('/dashboard');
  };
  const logout = () => {
    clearToken(); clearStoredUser(); setUser(null);
    rt.close(); setPage('home'); setActiveChannel('global'); setActiveProjectId(null);
    nav('/');
  };
  const goSignIn = () => nav('/login');
  const goSignUp = () => nav('/login?mode=register');

  const markAllRead = async () => {
    await api.post('/api/notifications/read-all', {});
    setNotifications(ns => ns.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  // Redirect logic
  useEffect(() => {
    if (!ready) return;
    if (user && (route === '/' || route === '/login')) nav('/dashboard');
    if (!user && route.startsWith('/dashboard')) nav('/login');
  }, [user, route, ready, nav]);

  const ctx = {
    user, login, register, logout, ready,
    theme, toggleTheme,
    page, setPage,
    activeProjectId, setActiveProjectId,
    activeChannel, setActiveChannel,
    toasts, toast,
    notifications, setNotifications, unreadCount, setUnreadCount, markAllRead,
    onlineUsers, users, rt, nav
  };

  if (!ready) {
    return <div className="h-full flex items-center justify-center text-muted">Loading Teamroom…</div>;
  }

  const isLanding = route === '/' && !user;
  const isLogin = route.startsWith('/login') && !user;
  const isApp = !!user;

  return (
    <AppCtx.Provider value={ctx}>
      {isLanding && <Landing />}
      {isLogin && <Login />}
      {isApp && <Dashboard />}
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
