import React, { useEffect, useState } from 'react';
import { Icon } from './Icons.jsx';
import { useApp } from '../App.jsx';
import { Avatar } from '../pages/Dashboard.jsx';
import { api } from '../lib/api.js';

const NAV = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'projects', label: 'Projects', icon: 'folder' },
  { id: 'files', label: 'Files', icon: 'file' },
  { id: 'team', label: 'Team', icon: 'users' },
  { id: 'settings', label: 'Settings', icon: 'settings', adminOnly: true }
];

export default function Sidebar() {
  const { page, setPage, user, setActiveProjectId, onlineUsers } = useApp();
  const [projects, setProjects] = useState([]);
  const [collapsed, setCollapsed] = useState(false);

  const isAdmin = user.role === 'owner' || user.role === 'admin';

  const loadProjects = async () => {
    try {
      const r = await api.get('/api/projects');
      setProjects(r.projects);
    } catch {}
  };
  useEffect(() => { loadProjects();
    const t = setInterval(loadProjects, 10000);
    const off = useApp().rt.on('project:create', loadProjects);
    const off2 = useApp().rt.on('project:delete', loadProjects);
    const off3 = useApp().rt.on('project:update', loadProjects);
    return () => { clearInterval(t); off?.(); off2?.(); off3?.(); };
  }, []);

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-64'} shrink-0 border-r border-border bg-surface flex flex-col transition-all duration-200`}>
      <div className="h-14 px-4 flex items-center justify-between border-b border-border">
        <div className={`flex items-center gap-2 ${collapsed ? 'justify-center w-full' : ''}`}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white">
            <Icon name="logo" size={16} />
          </div>
          {!collapsed && <span className="font-semibold tracking-tight">Teamroom</span>}
        </div>
        {!collapsed && (
          <button className="btn-ghost !p-1.5" onClick={() => setCollapsed(true)} title="Collapse">
            <Icon name="chevron" size={14} style={{ transform: 'rotate(90deg)' }} />
          </button>
        )}
        {collapsed && (
          <button className="btn-ghost !p-1.5 absolute left-14" onClick={() => setCollapsed(false)} title="Expand">
            <Icon name="chevron" size={14} style={{ transform: 'rotate(-90deg)' }} />
          </button>
        )}
      </div>

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV.filter(n => !n.adminOnly || isAdmin).map(item => (
          <button
            key={item.id}
            onClick={() => { setPage(item.id); if (item.id !== 'project') setActiveProjectId(null); }}
            className={`sidebar-item w-full ${page === item.id ? 'active' : ''} ${collapsed ? 'justify-center !px-2' : ''}`}
            title={item.label}
          >
            <Icon name={item.icon} size={18} />
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}

        {!collapsed && projects.length > 0 && (
          <div className="pt-4 pb-1 px-2 text-[11px] uppercase tracking-wide text-muted font-semibold">Projects</div>
        )}
        {!collapsed && projects.map(p => (
          <button
            key={p.id}
            onClick={() => { setPage('project'); setActiveProjectId(p.id); }}
            className={`sidebar-item w-full ${page === 'project' ? 'active' : ''}`}
            title={p.name}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="truncate">{p.name}</span>
          </button>
        ))}
      </nav>

      {!collapsed && (
        <div className="p-2 border-t border-border">
          <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted font-semibold">Online now</div>
          <div className="flex flex-wrap gap-1 px-1">
            {[...onlineUsers.values()].slice(0, 12).map(u => (
              <div key={u.id} className="relative" title={u.name}>
                <Avatar user={u} size={26} />
                <span className="absolute bottom-0 right-0 w-2 h-2 bg-success rounded-full ring-2 ring-surface" />
              </div>
            ))}
            {onlineUsers.size === 0 && <div className="text-xs text-muted px-2">You're the first online</div>}
          </div>
        </div>
      )}
    </aside>
  );
}
