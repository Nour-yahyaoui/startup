import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icons.jsx';
import { Avatar } from './Dashboard.jsx';
import Modal from '../components/Modal.jsx';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';

export default function Team() {
  const { user, toast, onlineUsers, rt, can } = useApp();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [open, setOpen] = useState(false);
  const [editRole, setEditRole] = useState(null);
  const isAdmin = user.role === 'owner' || user.role === 'admin';
  const canManageMembers = can('members.manage');
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const [u, r] = await Promise.all([api.get(isAdmin ? '/api/users?includeInactive=true' : '/api/users'), api.get('/api/roles')]);
      if (version === loadVersion.current) { setUsers(u.users); setRoles(r.roles); }
    } catch (e) { if (version === loadVersion.current) toast(e.message, 'error'); }
  }, [isAdmin, toast]);
  useEffect(() => {
    load();
    const offs = ['user:join', 'user:leave', 'user:update'].map(type => rt.on(type, load));
    return () => { loadVersion.current++; offs.forEach(off => off()); };
  }, [load, rt]);

  const remove = async (member) => {
    if (!confirm(`Deactivate ${member.name}? They will immediately lose access, but their project history and files will remain.`)) return;
    try {
      const result = await api.del('/api/users/' + member.id);
      setUsers(xs => xs.map(x => x.id === member.id ? result.user : x));
      toast('Member deactivated', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  const reactivate = async (member) => {
    try {
      const result = await api.post(`/api/users/${member.id}/reactivate`, {});
      setUsers(xs => xs.map(x => x.id === member.id ? result.user : x));
      toast('Member reactivated. Add them to projects again as needed.', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  const changeRole = async (u, role) => {
    try {
      await api.patch('/api/users/' + u.id, { role });
      setUsers(xs => xs.map(x => x.id === u.id ? { ...x, role } : x));
      toast('Role updated', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="text-muted text-sm mt-1">{users.filter(u => !u.disabledAt).length} active members · {onlineUsers.size} online now</p>
        </div>
        {canManageMembers && (
          <button className="btn-primary" onClick={() => setOpen(true)}><Icon name="plus" size={16}/> Create member</button>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-muted border-b border-border">
              <th className="px-4 py-3 font-semibold">Member</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map(u => {
              const online = onlineUsers.has(u.id);
              return (
                <tr key={u.id} className="hover:bg-surface2/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Avatar user={u} size={36}/>
                        {online && <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-success rounded-full ring-2 ring-surface"/>}
                      </div>
                      <div>
                        <div className="font-medium">{u.name} {u.id === user.id && <span className="text-xs text-muted">(you)</span>}</div>
                        <div className="text-xs text-muted">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {isAdmin && !u.disabledAt && u.id !== user.id ? (
                      <select className="input !py-1 !w-32 capitalize" value={u.role} onChange={e => changeRole(u, e.target.value)}>
                        {roles.map(r => <option key={r.name} value={r.name} className="capitalize">{r.name}</option>)}
                      </select>
                    ) : (
                      <span className="chip capitalize">{u.role}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${online && !u.disabledAt ? 'text-success' : 'text-muted'}`}>● {u.disabledAt ? 'Deactivated' : online ? 'Online' : 'Offline'}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canManageMembers && u.id !== user.id && (isAdmin || !['owner', 'admin'].includes(u.role)) && (
                      u.disabledAt
                        ? (isAdmin && <button className="btn-outline !text-xs" onClick={() => reactivate(u)}>Reactivate</button>)
                        : <button className="btn-ghost !p-1.5 text-danger" onClick={() => remove(u)} title="Deactivate member" aria-label={`Deactivate ${u.name}`}><Icon name="trash" size={16}/></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2"><Icon name="shield" size={16}/> Roles & permissions</h3>
            <button className="btn-outline" onClick={() => setEditRole({ name: '', permissions: [] })}><Icon name="plus" size={16}/> New role</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {roles.map(r => (
              <div key={r.name} className="p-3 rounded-lg border border-border">
                <div className="flex items-center justify-between">
                  <div className="font-medium capitalize">{r.name}</div>
                  {!['owner', 'admin'].includes(r.name) && <button className="btn-ghost !p-1.5" onClick={() => setEditRole(r)} aria-label={`Edit ${r.name} role`}><Icon name="edit" size={14}/></button>}
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {(JSON.parse(r.permissions || '[]')).map(p => <span key={p} className="chip !py-0 text-[11px]">{p}</span>)}
                  {r.permissions === '[]' && <span className="text-xs text-muted">No permissions</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <InviteModal open={open} onClose={() => setOpen(false)} roles={roles.filter(r => isAdmin || r.name === 'employee')} onCreated={load} />
      <RoleModal open={!!editRole} role={editRole} onClose={() => setEditRole(null)} onSaved={() => { setEditRole(null); load(); toast('Role saved', 'success'); }}/>
    </div>
  );
}

function InviteModal({ open, onClose, roles, onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'employee' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setError(''); }, [open]);
  const submit = async (e) => {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      await api.post('/api/users', form);
      setForm({ name: '', email: '', password: '', role: 'employee' });
      onCreated(); onClose();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Create team member">
      <form onSubmit={submit} className="space-y-4">
        <input className="input" placeholder="Full name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required autoFocus/>
        <input type="email" className="input" placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required/>
        <input type="password" className="input" placeholder="Initial password (min 6 chars)" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required minLength={6}/>
        <p className="text-xs text-muted">Share this password securely. The creator knows it, and members cannot change it yet.</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div>
          <label className="text-sm text-muted mb-1 block">Role</label>
          <select className="input capitalize" value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
            {roles.map(r => <option key={r.name} value={r.name} className="capitalize">{r.name}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create member'}</button>
        </div>
      </form>
    </Modal>
  );
}

const PERMISSIONS = ['projects.write','tasks.write','chat.write','files.write','members.manage'];

function RoleModal({ open, role, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [perms, setPerms] = useState([]);
  const [isNew, setIsNew] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (role) {
      setError('');
      setName(role.name || '');
      try {
        const p = JSON.parse(role.permissions || '[]');
        setPerms(Array.isArray(p) ? p : []);
      } catch { setPerms([]); }
      setIsNew(!role.name);
    }
  }, [role]);
  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      if (isNew) await api.post('/api/roles', { name, permissions: perms });
      else await api.patch('/api/roles/' + name, { permissions: perms });
      onSaved();
    } catch (e) { setError(e.message); }
  };
  const toggle = (p) => setPerms(xs => xs.includes(p) ? xs.filter(x => x !== p) : [...xs, p]);
  const canDelete = !['owner','admin','manager','employee','viewer'].includes(name);
  const del = async () => {
    if (!canDelete) return;
    if (!confirm('Delete this role?')) return;
    try { await api.del('/api/roles/' + name); onSaved(); }
    catch (e) { setError(e.message); }
  };
  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'New role' : `Edit role: ${name}`}>
      <form onSubmit={save} className="space-y-4">
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div>
          <label className="text-sm text-muted mb-1 block">Role name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} disabled={!isNew} required placeholder="e.g. designer"/>
        </div>
        <div>
          <label className="text-sm text-muted mb-2 block">Permissions</label>
          <div className="space-y-2">
            {PERMISSIONS.map(p => (
              <label key={p} className="flex items-center gap-2 p-2 rounded-lg border border-border cursor-pointer hover:bg-surface2">
                <input type="checkbox" checked={perms.includes(p)} onChange={() => toggle(p)}/>
                <span className="text-sm font-mono">{p}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-between gap-2 pt-2">
          {!isNew && canDelete && <button type="button" className="btn-danger" onClick={del}><Icon name="trash" size={16}/> Delete</button>}
          <div className="flex gap-2 ml-auto">
            <button type="button" className="btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn-primary">Save</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
