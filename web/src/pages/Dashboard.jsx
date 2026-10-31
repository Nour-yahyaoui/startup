import React, { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import Home from './Home.jsx';
import Chat from './Chat.jsx';
import Projects from './Projects.jsx';
import ProjectDetail from './ProjectDetail.jsx';
import Files from './Files.jsx';
import Team from './Team.jsx';
import Settings from './Settings.jsx';
import NotificationsPopover from '../components/NotificationsPopover.jsx';
import { Icon } from '../components/Icons.jsx';
import { useApp } from '../App.jsx';

export default function Dashboard() {
  const { page, setPage, activeProjectId, user, logout, theme, toggleTheme, setActiveProjectId } = useApp();
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    if (page === 'project' && !activeProjectId) setPage('projects');
  }, [page, activeProjectId, setPage]);

  return (
    <div className="h-full flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="btn-ghost" title="Toggle theme">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
            <div className="relative">
              <button onClick={() => setNotifOpen(o => !o)} className="btn-ghost relative" title="Notifications">
                <Icon name="bell" />
                <NotifBadge />
              </button>
              {notifOpen && <NotificationsPopover onClose={() => setNotifOpen(false)} />}
            </div>
            <UserMenu user={user} logout={logout} />
          </div>
        </TopBar>
        <div className="flex-1 overflow-auto">
          {page === 'home' && <Home />}
          {page === 'chat' && <Chat />}
          {page === 'projects' && <Projects />}
          {page === 'project' && <ProjectDetail />}
          {page === 'files' && <Files />}
          {page === 'team' && <Team />}
          {page === 'settings' && <Settings />}
        </div>
      </div>
    </div>
  );
}

function TopBar({ children }) {
  const { page } = useApp();
  const titles = {
    home: 'Home',
    chat: 'Chat',
    projects: 'Projects',
    project: 'Project',
    files: 'Files',
    team: 'Team',
    settings: 'Settings'
  };
  return (
    <header className="h-14 border-b border-border bg-bg/80 backdrop-blur px-6 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold">{titles[page] || 'Teamroom'}</h2>
        <span className="chip"><Icon name="zap" size={12}/> Realtime</span>
      </div>
      {children}
    </header>
  );
}

function NotifBadge() {
  const { unreadCount } = useApp();
  if (!unreadCount) return null;
  return <span className="absolute -top-0.5 -right-0.5 bg-danger text-white text-[10px] rounded-full min-w-4 h-4 px-1 flex items-center justify-center">{unreadCount > 99 ? '99+' : unreadCount}</span>;
}

function UserMenu({ user, logout }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 btn-ghost px-2">
        <Avatar user={user} size={28} />
        <span className="text-sm hidden sm:block">{user.name}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-56 card p-1 z-40 animate-fade-in">
            <div className="px-3 py-2 border-b border-border">
              <div className="text-sm font-medium">{user.name}</div>
              <div className="text-xs text-muted">{user.email}</div>
              <div className="mt-1"><span className="chip capitalize">{user.role}</span></div>
            </div>
            <button onClick={() => { setOpen(false); logout(); }} className="w-full text-left px-3 py-2 rounded-md hover:bg-surface2 text-sm flex items-center gap-2">
              <Icon name="logout" size={16} /> Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Avatar({ user, size = 32, className = '' }) {
  const initials = (user?.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const color = user?.avatarColor || '#6366f1';
  return (
    <div
      className={`rounded-full flex items-center justify-center font-semibold text-white ${className}`}
      style={{ background: color, width: size, height: size, fontSize: size * 0.38 }}
      title={user?.name || '?'}
    >{initials}</div>
  );
}
