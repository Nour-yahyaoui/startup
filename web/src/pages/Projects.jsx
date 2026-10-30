import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icons.jsx';
import { Avatar } from './Dashboard.jsx';
import Modal from '../components/Modal.jsx';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';

const COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#06b6d4','#8b5cf6','#ef4444','#14b8a6'];

export default function Projects() {
  const { setPage, setActiveProjectId, toast, user, rt, can } = useApp();
  const [projects, setProjects] = useState([]);
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const canCreate = can('projects.write');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const r = await api.get('/api/projects');
      if (version === loadVersion.current) { setProjects(r.projects); setError(''); }
    } catch (e) { if (version === loadVersion.current) setError(e.message); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    api.get('/api/users').then(r => setUsers(r.users)).catch(() => {});
    const offs = ['project:create', 'project:update', 'project:delete', 'project:access-revoked', 'project:membership-changed'].map(type => rt.on(type, load));
    return () => { loadVersion.current++; offs.forEach(off => off()); };
  }, [load, rt, user.role]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap gap-4 items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted text-sm mt-1">Keep client work organized and accessible to the right people.</p>
        </div>
        {canCreate && <button className="btn-primary" onClick={() => setOpen(true)}><Icon name="plus" size={16}/> New project</button>}
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 mb-6 text-sm">
        <Icon name="shield" size={18} className="text-primary shrink-0 mt-0.5" />
        <div><span className="font-medium">Private by default.</span> <span className="text-muted">Projects, their files and conversations are visible to project members and workspace admins.</span></div>
      </div>

      {error && <div className="card p-4 text-sm text-danger" role="alert">{error} <button className="underline ml-2" onClick={load}>Try again</button></div>}
      {!error && loading ? <div className="text-sm text-muted py-8">Loading projects…</div> : !error && projects.length === 0 ? (
        <div className="card p-10 text-center">
          <Icon name="folder" size={36} className="mx-auto mb-3 text-muted opacity-50"/>
          <div className="font-medium">No projects to show</div>
          <div className="text-muted text-sm mt-1">{canCreate ? 'Create a private project to bring your work together.' : 'Projects shared with you will appear here.'}</div>
          {canCreate && <button className="btn-primary mt-4" onClick={() => setOpen(true)}><Icon name="plus" size={16}/> New project</button>}
        </div>
      ) : !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => (
            <button key={p.id} className="card p-5 text-left hover:border-primary/40 transition" onClick={() => { setActiveProjectId(p.id); setPage('project'); }}>
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-semibold" style={{ background: p.color }}>{p.name[0].toUpperCase()}</div>
                <span className="chip text-muted"><Icon name="lock" size={12}/> Private</span>
              </div>
              <div className="font-semibold truncate">{p.name}</div>
              <div className="text-sm text-muted mt-1 line-clamp-2 min-h-[1.25rem]">{p.description || 'A private space for your team’s work.'}</div>
              <div className="flex items-center justify-between mt-5 pt-4 border-t border-border">
                <div className="flex -space-x-2" aria-label={`${p.members.length} project members`}>
                  {p.members.slice(0, 5).map(m => <Avatar key={m.id} user={m} size={26} className="ring-2 ring-surface"/>)}
                  {p.members.length > 5 && <span className="w-6 h-6 rounded-full bg-surface2 text-xs flex items-center justify-center ring-2 ring-surface">+{p.members.length - 5}</span>}
                </div>
                <span className="text-xs text-muted">{p.members.length} {p.members.length === 1 ? 'member' : 'members'}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <NewProjectModal open={open} onClose={() => setOpen(false)} users={users} user={user}
        onCreated={() => { load(); setOpen(false); toast('Private project created', 'success'); }} />
    </div>
  );
}

function NewProjectModal({ open, onClose, users, user, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [memberIds, setMemberIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError('');
    try {
      await api.post('/api/projects', { name: name.trim(), description, color, memberIds });
      setName(''); setDescription(''); setColor(COLORS[0]); setMemberIds([]);
      onCreated();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create a private project">
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-sm flex gap-2">
          <Icon name="lock" size={16} className="text-primary shrink-0 mt-0.5" />
          <span>Only selected members and workspace admins can access this project, its tasks, files and chat.</span>
        </div>
        <label className="block text-sm text-muted">Name
          <input className="input mt-1" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Acme client launch" required />
        </label>
        <label className="block text-sm text-muted">Description
          <textarea className="input mt-1" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this project about?" />
        </label>
        <div>
          <div className="text-sm text-muted mb-2">Color</div>
          <div className="flex flex-wrap gap-2">
            {COLORS.map(c => <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Choose color ${c}`} aria-pressed={color === c}
              className={`w-8 h-8 rounded-full transition ${color === c ? 'ring-2 ring-offset-2 ring-offset-surface ring-fg' : ''}`} style={{ background: c }} />)}
          </div>
        </div>
        <div>
          <div className="text-sm text-muted mb-1">Project members</div>
          <p className="text-xs text-muted mb-2">You are included automatically. You can change access later.</p>
          <div className="flex flex-wrap gap-2 max-h-36 overflow-auto">
            {users.filter(u => u.id !== user.id && u.role !== 'owner' && u.role !== 'admin').map(u => {
              const on = memberIds.includes(u.id);
              return <button type="button" key={u.id} aria-pressed={on} onClick={() => setMemberIds(ids => on ? ids.filter(x => x !== u.id) : [...ids, u.id])}
                className={`chip px-2 py-1 cursor-pointer transition ${on ? 'bg-primary/20 text-primary border-primary/40' : ''}`}><Avatar user={u} size={18} /> {u.name}</button>;
            })}
          </div>
        </div>
        {error && <div className="text-sm text-danger" role="alert">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create project'}</button>
        </div>
      </form>
    </Modal>
  );
}
