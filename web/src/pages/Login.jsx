import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon } from '../components/Icons.jsx';
import { useApp } from '../App.jsx';

export default function Login() {
  const { login, register, theme, toggleTheme } = useApp();
  const [mode, setMode] = useState('login'); // login | register
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [registrationOpen, setRegistrationOpen] = useState(false);

  useEffect(() => {
    api.get('/api/auth/bootstrap').then(({ registrationOpen: open }) => {
      setRegistrationOpen(open);
      if (open) setMode('register');
    }).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, name, password);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <button onClick={toggleTheme} className="absolute top-4 right-4 btn-ghost" title="Toggle theme">
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white">
            <Icon name="logo" size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Nexa</h1>
            <p className="text-sm text-muted">Realtime workspace for teams</p>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex gap-1 p-1 bg-surface2 rounded-lg mb-6">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition ${mode === 'login' ? 'bg-surface shadow-soft' : 'text-muted'}`}
            >Sign in</button>
            {registrationOpen && <button
              type="button"
              onClick={() => setMode('register')}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition ${mode === 'register' ? 'bg-surface shadow-soft' : 'text-muted'}`}
            >Create workspace</button>}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === 'register' && (
              <div>
                <label className="text-sm text-muted mb-1 block">Full name</label>
                <input className="input" autoFocus={mode === 'register'}
                  placeholder="Jane Doe" value={name} onChange={e => setName(e.target.value)} required />
              </div>
            )}
            <div>
              <label className="text-sm text-muted mb-1 block">Email</label>
              <input type="email" className="input" autoFocus={mode === 'login'}
                placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="text-sm text-muted mb-1 block">Password</label>
              <input type="password" className="input" placeholder="••••••••" minLength={6}
                value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            {err && <div className="text-sm text-danger">{err}</div>}
            <button className="btn-primary w-full py-2 mt-2" disabled={loading}>
              {loading ? '…' : mode === 'login' ? 'Sign in' : 'Create my account'}
            </button>
          </form>

          <p className="text-xs text-muted mt-6 text-center">
            {mode === 'login'
              ? "Need an account? Ask a workspace administrator to add you."
              : "Set up the first owner account. Additional members must be added by an administrator."}
          </p>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2 text-xs text-muted">
          <Feature icon="zap" title="Realtime" desc="Everything updates live" />
          <Feature icon="folder" title="Fast file transfer" desc="Drag & drop, no size drama" />
          <Feature icon="chat" title="Built-in chat" desc="Private project channels" />
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, title, desc }) {
  return (
    <div className="card p-3 flex flex-col items-center text-center">
      <div className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center mb-2">
        <Icon name={icon} size={16} />
      </div>
      <div className="font-medium text-fg text-[13px]">{title}</div>
      <div className="text-[11px] leading-tight mt-0.5">{desc}</div>
    </div>
  );
}
