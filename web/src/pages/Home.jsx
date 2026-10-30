import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon } from '../components/Icons.jsx';
import { useApp } from '../App.jsx';
import { formatBytes, formatRelative } from '../lib/util.js';
import FileDropZone from '../components/FileDropZone.jsx';

export default function Home() {
  const { user, setPage, toast, rt, can } = useApp();
  const [stats, setStats] = useState({ projects: 0, tasks: 0, myTasks: 0, files: 0, messages: 0 });
  const [quickFiles, setQuickFiles] = useState([]);

  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const [projects, files] = await Promise.all([api.get('/api/projects'), api.get('/api/files')]);
      const projectTasks = await Promise.all(projects.projects.map(p => api.get(`/api/projects/${p.id}/tasks`)));
      if (version !== loadVersion.current) return;
      const openTasks = projectTasks.flatMap(result => result.tasks).filter(task => task.status !== 'done');
      setStats({ projects: projects.projects.length, tasks: openTasks.length,
        myTasks: openTasks.filter(task => task.assigneeId === user.id).length, files: files.files.length, messages: 0 });
      setQuickFiles(files.files.slice(0, 6));
    } catch { /* A revocation can invalidate an in-flight project request. */ }
  }, [user.id, user.role]);

  useEffect(() => {
    load();
    const removeProject = ev => { setQuickFiles(files => files.filter(f => f.projectId !== ev.projectId)); load(); };
    const offs = [rt.on('project:access-revoked', removeProject), rt.on('project:delete', removeProject),
      rt.on('project:create', load), rt.on('project:update', load), rt.on('project:membership-changed', load), rt.on('file:new', load), rt.on('file:delete', load)];
    return () => { loadVersion.current++; offs.forEach(off => off()); };
  }, [load, rt]);

  const download = file => api.download(file.id, file.name).catch(e => toast(e.message, 'error'));

  const cards = [
    { key: 'chat', label: 'Team chat', desc: 'Jump into the conversation', icon: 'chat', onClick: () => setPage('chat') },
    { key: 'projects', label: 'Projects', desc: `${stats.projects} active`, icon: 'folder', onClick: () => setPage('projects') },
    { key: 'mytasks', label: 'My tasks', desc: `${stats.myTasks} to do`, icon: 'tasks', onClick: () => setPage('projects') },
    { key: 'files', label: 'Files', desc: `${stats.files} shared`, icon: 'file', onClick: () => setPage('files') }
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="card p-6 bg-gradient-to-br from-primary/10 via-transparent to-accent/10 border-primary/20">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {user.name.split(' ')[0]} 👋</h1>
        <p className="text-muted mt-1">Here's what's happening across your team today. Everything updates in real-time.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => setPage('chat')}><Icon name="chat" size={16}/> Open chat</button>
          <button className="btn-outline" onClick={() => setPage('projects')}><Icon name="folder" size={16}/> View projects</button>
          {can('files.write') && <button className="btn-outline" onClick={() => setPage('files')}><Icon name="upload" size={16}/> Upload a file</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon="folder" label="Projects" value={stats.projects} color="#6366f1" />
        <Stat icon="tasks" label="Open tasks" value={stats.tasks} color="#10b981" />
        <Stat icon="zap" label="My to-dos" value={stats.myTasks} color="#f59e0b" />
        <Stat icon="file" label="Files" value={stats.files} color="#ec4899" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-5">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Icon name="sparkle" size={16} className="text-accent" /> Quick actions</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {cards.map(c => (
                <button key={c.key} onClick={c.onClick}
                  className="p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-surface2 transition text-left">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-2">
                    <Icon name={c.icon} size={18} />
                  </div>
                  <div className="text-sm font-medium">{c.label}</div>
                  <div className="text-xs text-muted">{c.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {can('files.write') && <FileDropZone />}
        </div>

        <div className="card p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Icon name="file" size={16} /> Recent files</h3>
          <div className="space-y-2">
            {quickFiles.length === 0 && <div className="text-sm text-muted">No files yet. Upload one to get started.</div>}
            {quickFiles.map(f => (
              <button key={f.id} onClick={() => download(f)} className="w-full text-left flex items-center gap-3 p-2 rounded-lg hover:bg-surface2 transition" aria-label={`Download ${f.name}`}>
                <div className="w-9 h-9 rounded-lg bg-surface2 flex items-center justify-center">
                  <Icon name={f.mimeType.startsWith('image/') ? 'image' : 'file'} size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{f.name}</div>
                  <div className="text-xs text-muted">{formatBytes(f.size)} · {formatRelative(f.createdAt)}</div>
                </div>
                <Icon name="download" size={16} className="text-muted" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, color }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: color + '20', color }}>
          <Icon name={icon} size={18} />
        </div>
        <div className="text-2xl font-semibold">{value}</div>
      </div>
      <div className="text-sm text-muted mt-2">{label}</div>
    </div>
  );
}
