import React, { useState } from 'react';
import { Icon } from '../components/Icons.jsx';
import { Avatar } from './Dashboard.jsx';
import { useApp } from '../App.jsx';
import { api } from '../lib/api.js';

const COLORS = ['#ef4444','#f97316','#f59e0b','#84cc16','#22c55e','#10b981','#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e'];

export default function Settings() {
  const { user, theme, toggleTheme, toast } = useApp();
  const isAdmin = user.role === 'owner' || user.role === 'admin';

  const [name, setName] = useState(user.name || '');
  const [title, setTitle] = useState(user.title || '');
  const [color, setColor] = useState(user.avatarColor || '#6366f1');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPw, setCurrentPw] = useState('');
  const [nextPw, setNextPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState('');

  const saveProfile = async (e) => {
    e.preventDefault();
    if (savingProfile) return;
    if (!name.trim()) { toast('Add a name so teammates know who you are.', 'error'); return; }
    setSavingProfile(true);
    try {
      await api.patch('/api/users/me', { name: name.trim(), title: title.trim() || null, avatarColor: color });
      toast('Profile saved', 'success');
    } catch (err) {
      toast(err.message || "We couldn't save your profile. Nothing was changed — try again.", 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (savingPw) return;
    setPwError('');
    if (!currentPw || !nextPw) { setPwError('Fill in both your current password and the new one.'); return; }
    if (nextPw.length < 6) { setPwError('The new password needs at least 6 characters.'); return; }
    setSavingPw(true);
    try {
      await api.post('/api/users/me/password', { current: currentPw, next: nextPw });
      setCurrentPw(''); setNextPw('');
      toast('Password updated. Use it next time you sign in.', 'success');
    } catch (err) {
      setPwError(err.message || "The password didn't change — try again.");
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <div className="card p-5">
        <h3 className="font-semibold mb-4">Appearance</h3>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Theme</div>
            <div className="text-xs text-muted">Switch between dark and light mode. Saved on this device.</div>
          </div>
          <div className="flex gap-1 p-1 bg-surface2 rounded-lg">
            <button onClick={() => document.documentElement.classList.contains('dark') && toggleTheme()}
              className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-2 ${theme === 'light' ? 'bg-surface shadow-soft' : 'text-muted'}`}>
              <Icon name="sun" size={14}/> Light
            </button>
            <button onClick={() => !document.documentElement.classList.contains('dark') && toggleTheme()}
              className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-2 ${theme === 'dark' ? 'bg-surface shadow-soft' : 'text-muted'}`}>
              <Icon name="moon" size={14}/> Dark
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={saveProfile} className="card p-5">
        <h3 className="font-semibold mb-4">Your profile</h3>
        <div className="flex items-center gap-4 mb-4">
          <Avatar user={{ name: name || user.name, avatarColor: color }} size={60}/>
          <div className="min-w-0">
            <div className="font-medium truncate">{name || user.name}</div>
            <div className="text-sm text-muted truncate">{user.email}</div>
            <div className="mt-1"><span className="chip capitalize">{user.role}</span></div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-muted">Display name</span>
            <input className="input mt-1" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sara Ben Ali" />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Job title <span className="opacity-60">(optional)</span></span>
            <input className="input mt-1" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Frontend engineer" />
          </label>
        </div>
        <div className="mt-3">
          <span className="text-xs text-muted">Avatar colour</span>
          <div className="flex flex-wrap gap-2 mt-2">
            {COLORS.map(c => (
              <button type="button" key={c} onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full transition ${color === c ? 'ring-2 ring-offset-2 ring-offset-surface ring-primary scale-110' : 'hover:scale-110'}`}
                style={{ background: c }} aria-label={`Colour ${c}`} />
            ))}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="submit" disabled={savingProfile} className="btn-primary">
            {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
          <span className="text-xs text-muted">Teammates see the change instantly.</span>
        </div>
      </form>

      <form onSubmit={savePassword} className="card p-5">
        <h3 className="font-semibold mb-4">Password</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-muted">Current password</span>
            <input type="password" className="input mt-1" value={currentPw} onChange={e => setCurrentPw(e.target.value)} autoComplete="current-password" />
          </label>
          <label className="block">
            <span className="text-xs text-muted">New password <span className="opacity-60">(min 6 characters)</span></span>
            <input type="password" className="input mt-1" value={nextPw} onChange={e => setNextPw(e.target.value)} autoComplete="new-password" />
          </label>
        </div>
        {pwError && <p className="text-sm text-danger mt-2">{pwError}</p>}
        <button type="submit" disabled={savingPw} className="btn-outline mt-4">
          {savingPw ? 'Updating…' : 'Update password'}
        </button>
      </form>

      <div className="card p-5">
        <h3 className="font-semibold mb-2 flex items-center gap-2"><Icon name="zap" size={16}/> About Teamroom</h3>
        <div className="text-sm text-muted space-y-2">
          <p>Teamroom is a realtime workspace for companies: chat with DMs, file transfer, projects and tasks — all in one place.</p>
          <p className="text-xs">Version 1.5.0 · Built with Fastify, WebSockets and React · MIT licensed</p>
        </div>
      </div>

      {isAdmin && (
        <div className="card p-5">
          <h3 className="font-semibold mb-2 flex items-center gap-2"><Icon name="shield" size={16}/> Admin shortcuts</h3>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <button className="btn-outline justify-start" onClick={() => window.location.hash = '#/team'}>
              <Icon name="users" size={16}/> Manage team & roles
            </button>
            <button className="btn-outline justify-start" onClick={() => window.location.hash = '#/projects'}>
              <Icon name="folder" size={16}/> Manage projects
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
