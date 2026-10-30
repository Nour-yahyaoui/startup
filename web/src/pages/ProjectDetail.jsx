import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Icon } from '../components/Icons.jsx';
import { Avatar } from './Dashboard.jsx';
import Modal from '../components/Modal.jsx';
import FileDropZone from '../components/FileDropZone.jsx';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { formatBytes, formatRelative } from '../lib/util.js';

const COLUMNS = [
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'done', label: 'Done' }
];
const PRIORITIES = { low: 'text-muted', medium: 'text-warn', high: 'text-danger' };

export default function ProjectDetail() {
  const { activeProjectId: id, setPage, rt, user, toast, can } = useApp();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [files, setFiles] = useState([]);
  const [users, setUsers] = useState([]);
  const canWriteTasks = can('tasks.write');
  const canWriteFiles = can('files.write');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('board');
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const loadVersion = useRef(0);

  const isAdmin = user.role === 'owner' || user.role === 'admin';
  const canManageAccess = project && (isAdmin || project.ownerId === user.id);

  const load = useCallback(async () => {
    if (!id) return;
    const version = ++loadVersion.current;
    try {
      const [p, t, f, u] = await Promise.all([
        api.get(`/api/projects/${id}`), api.get(`/api/projects/${id}/tasks`),
        api.get(`/api/files?projectId=${encodeURIComponent(id)}`), api.get('/api/users')
      ]);
      if (version !== loadVersion.current) return;
      setProject(p.project); setTasks(t.tasks); setFiles(f.files); setUsers(u.users); setError('');
    } catch (e) {
      if (version === loadVersion.current) setError(e.status === 404 ? 'This project is no longer available to you.' : e.message);
    }
  }, [id, user.role, isAdmin]);

  useEffect(() => {
    setProject(null); setError(''); setTab('board'); load();
    return () => { loadVersion.current++; };
  }, [load]);

  useEffect(() => {
    if (!id) return;
    const ch = 'project:' + id;
    rt.subscribe(ch);
    const off1 = rt.on('task:create', ev => { if (ev.task?.projectId === id) setTasks(t => [...t.filter(x => x.id !== ev.task.id), ev.task]); });
    const off2 = rt.on('task:update', ev => { if (ev.task?.projectId === id) setTasks(t => t.map(x => x.id === ev.task.id ? ev.task : x)); });
    const off3 = rt.on('task:done', ev => {
      if (ev.task?.projectId !== id) return;
      setTasks(t => t.map(x => x.id === ev.task.id ? ev.task : x));
      toast(`Task completed by ${ev.actor.name}`, 'success');
    });
    const off4 = rt.on('task:reopen', ev => { if (ev.task?.projectId === id) setTasks(t => t.map(x => x.id === ev.task.id ? ev.task : x)); });
    const off5 = rt.on('task:delete', ev => { if (ev.projectId === id) setTasks(t => t.filter(x => x.id !== ev.taskId)); });
    const off6 = rt.on('file:new', ev => { if (ev.file?.projectId === id) setFiles(f => [ev.file, ...f.filter(x => x.id !== ev.file.id)]); });
    const off7 = rt.on('file:delete', ev => setFiles(f => f.filter(x => x.id !== ev.fileId)));
    const off8 = rt.on('project:update', ev => {
      if (ev.project?.id !== id) return;
      setProject(ev.project);
      // Membership removal can unassign tasks and invalidate an in-flight load.
      load();
    });
    const off9 = rt.on('project:membership-changed', ev => { if (ev.projectId === id) load(); });
    return () => { off1(); off2(); off3(); off4(); off5(); off6(); off7(); off8(); off9(); rt.unsubscribe(ch); };
  }, [id, rt, toast, load]);

  const moveTask = async (taskId, status) => {
    setTasks(t => t.map(x => x.id === taskId ? { ...x, status } : x));
    try { await api.patch('/api/tasks/' + taskId, { status }); }
    catch (e) { toast(e.message, 'error'); load(); }
  };
  const toggleDone = async (taskId) => {
    const task = tasks.find(x => x.id === taskId);
    if (!task) return;
    const newStatus = task.status === 'done' ? 'todo' : 'done';
    setTasks(ts => ts.map(x => x.id === taskId ? { ...x, status: newStatus } : x));
    try { await api.post(`/api/tasks/${taskId}/done`); }
    catch (e) { toast(e.message, 'error'); load(); }
  };
  const deleteTask = async (taskId) => {
    if (!confirm('Delete this task?')) return;
    try { await api.del('/api/tasks/' + taskId); setTasks(t => t.filter(x => x.id !== taskId)); }
    catch (e) { toast(e.message, 'error'); }
  };
  const download = file => api.download(file.id, file.name).catch(e => toast(e.message, 'error'));

  if (error) return <div className="p-6"><div className="card p-6"><p role="alert">{error}</p><button className="btn-outline mt-4" onClick={() => setPage('projects')}>Back to projects</button></div></div>;
  if (!project) return <div className="p-6 text-muted">Loading project…</div>;

  const eligibleAssignees = users.filter(u => u.role === 'owner' || u.role === 'admin' ||
    u.id === project.ownerId || project.members.some(m => m.id === u.id));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <button onClick={() => setPage('projects')} className="btn-ghost !px-2 mb-4"><Icon name="arrowLeft" size={16}/> Back to projects</button>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl font-semibold shrink-0" style={{ background: project.color }}>{project.name[0].toUpperCase()}</div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1><span className="chip text-muted"><Icon name="lock" size={12}/> Private project</span></div>
            {project.description && <p className="text-muted text-sm mt-1 max-w-2xl">{project.description}</p>}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="chip"><Icon name="tasks" size={12}/> {tasks.length} tasks</span>
              <span className="chip"><Icon name="file" size={12}/> {files.length} files</span>
              <span className="text-xs text-muted">Members + workspace admins</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" onClick={() => setAccessOpen(true)}><Icon name="users" size={16}/> {canManageAccess ? 'Manage access' : 'View members'}</button>
          <button className="btn-outline" onClick={() => setTab(tab === 'board' ? 'files' : 'board')}><Icon name={tab === 'board' ? 'file' : 'tasks'} size={16}/> {tab === 'board' ? 'Files' : 'Board'}</button>
          {canWriteTasks && <button className="btn-primary" onClick={() => setNewTaskOpen(true)}><Icon name="plus" size={16}/> New task</button>}
        </div>
      </div>

      {tab === 'board' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {COLUMNS.map(col => {
            const colTasks = tasks.filter(t => t.status === col.id);
            return (
              <div key={col.id} className="card p-3 bg-surface2/50" onDragOver={e => { if (canWriteTasks) e.preventDefault(); }}
                onDrop={e => { e.preventDefault(); const taskId = e.dataTransfer.getData('text/task-id'); if (canWriteTasks && taskId) moveTask(taskId, col.id); }}>
                <div className="flex items-center justify-between px-2 py-1 mb-2"><div className="font-medium text-sm">{col.label} <span className="text-muted">({colTasks.length})</span></div></div>
                <div className="space-y-2 min-h-[100px]">
                  {colTasks.length === 0 && <div className="text-xs text-muted text-center py-6">No tasks here</div>}
                  {colTasks.map(t => (
                    <div key={t.id} draggable={canWriteTasks} onDragStart={e => e.dataTransfer.setData('text/task-id', t.id)}
                      className={`card p-3 hover:border-primary/40 transition ${canWriteTasks ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0"><div className={`text-sm font-medium ${t.status === 'done' ? 'line-through text-muted' : ''}`}>{t.title}</div>{t.description && <div className="text-xs text-muted mt-1 line-clamp-2">{t.description}</div>}</div>
                        {canWriteTasks && <div className="flex gap-1 shrink-0">
                          <button onClick={() => toggleDone(t.id)} className="btn-ghost !p-1" title={t.status === 'done' ? 'Reopen' : 'Mark done'} aria-label={`${t.status === 'done' ? 'Reopen' : 'Mark done'}: ${t.title}`}><Icon name="check" size={14} className={t.status === 'done' ? 'text-success' : ''}/></button>
                          <button onClick={() => deleteTask(t.id)} className="btn-ghost !p-1 text-danger" aria-label={`Delete ${t.title}`}><Icon name="trash" size={14}/></button>
                        </div>}
                      </div>
                      <div className="flex items-center justify-between mt-2"><span className={`text-[11px] font-medium ${PRIORITIES[t.priority] || ''} capitalize`}>● {t.priority}</span>{t.assignee ? <Avatar user={t.assignee} size={20} /> : <div className="w-5 h-5" />}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {canWriteFiles && <FileDropZone projectId={id} />}
          <div className="card overflow-hidden"><div className="divide-y divide-border">
            {files.length === 0 && <div className="p-8 text-center text-muted">No files yet. Add one to share it with this project.</div>}
            {files.map(f => <div key={f.id} className="flex items-center gap-3 p-3 hover:bg-surface2 transition">
              <div className="w-9 h-9 rounded-lg bg-surface2 flex items-center justify-center"><Icon name={f.mimeType.startsWith('image/') ? 'image' : 'file'} size={18}/></div>
              <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{f.name}</div><div className="text-xs text-muted">{formatBytes(f.size)} · {f.uploader.name} · {formatRelative(f.createdAt)}</div></div>
              <button className="btn-ghost !p-2" onClick={() => download(f)} title="Download" aria-label={`Download ${f.name}`}><Icon name="download" size={16}/></button>
            </div>)}
          </div></div>
        </div>
      )}

      <ProjectAccessModal open={accessOpen} onClose={() => setAccessOpen(false)} project={project} users={users}
        canManage={canManageAccess} onChanged={setProject} toast={toast} />
      <NewTaskModal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} users={eligibleAssignees} projectId={id}
        onCreated={() => { setNewTaskOpen(false); toast('Task created', 'success'); }} />
    </div>
  );
}

function ProjectAccessModal({ open, onClose, project, users, canManage, onChanged, toast }) {
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (!open) { setSearch(''); setError(''); } }, [open]);
  const memberIds = new Set(project.members.map(member => member.id));
  const workspaceAdmins = users.filter(u => (u.role === 'owner' || u.role === 'admin') && !memberIds.has(u.id));
  const available = users.filter(u => !memberIds.has(u.id) && u.role !== 'owner' && u.role !== 'admin' &&
    `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase()));

  const update = async (member, adding) => {
    if (!adding && !confirm(`Remove ${member.name} from this project? Their project tasks will be unassigned.`)) return;
    setBusy(member.id); setError('');
    try {
      const result = adding
        ? await api.post(`/api/projects/${project.id}/members`, { userId: member.id })
        : await api.del(`/api/projects/${project.id}/members/${member.id}`);
      onChanged(result.project);
      toast(adding ? `${member.name} added to the project` : `${member.name} removed from the project`, 'success');
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Project access" size="lg">
      <div className="space-y-5">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><Icon name="shield" size={18}/></div>
          <div><div className="text-sm font-semibold">A private space for {project.name}</div><p className="text-xs text-muted mt-1 leading-relaxed">Only project members and workspace owners or admins can see its tasks, files and conversation. Workspace admins always have access.</p></div>
        </div>
        <div>
          <div className="flex justify-between items-center mb-2"><h4 className="text-sm font-semibold">Project members</h4><span className="text-xs text-muted">{project.members.length} people</span></div>
          <div className="border border-border rounded-lg divide-y divide-border max-h-52 overflow-auto">
            {project.members.map(member => {
              const owner = member.id === project.ownerId;
              const admin = member.role === 'owner' || member.role === 'admin';
              return <div key={member.id} className="flex items-center gap-3 p-3">
                <Avatar user={member} size={32}/>
                <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{member.name}</div><div className="text-xs text-muted truncate">{owner ? `Project owner${member.disabledAt ? ' · deactivated' : ''}` : admin ? 'Workspace admin · access inherited' : member.email}</div></div>
                {canManage && !owner && !admin && <button type="button" className="btn-ghost text-danger !text-xs" disabled={!!busy} onClick={() => update(member, false)} aria-label={`Remove ${member.name} from project`}>{busy === member.id ? 'Removing…' : 'Remove'}</button>}
              </div>;
            })}
          </div>
          {workspaceAdmins.length > 0 && <p className="text-xs text-muted mt-2">Also accessible to workspace admins: {workspaceAdmins.map(u => u.name).join(', ')}.</p>}
        </div>
        {canManage && <div>
          <h4 className="text-sm font-semibold mb-1">Add people</h4>
          <p className="text-xs text-muted mb-2">Choose existing workspace members. They get access immediately.</p>
          <input className="input" placeholder="Search people by name or email" aria-label="Search workspace members" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="mt-2 max-h-36 overflow-auto space-y-1">
            {available.length === 0 && <p className="text-xs text-muted py-2">No more people to add.</p>}
            {available.map(member => <div key={member.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface2">
              <Avatar user={member} size={28}/><div className="flex-1 min-w-0"><div className="text-sm truncate">{member.name}</div><div className="text-xs text-muted truncate">{member.email}</div></div>
              <button type="button" className="btn-outline !text-xs" disabled={!!busy} onClick={() => update(member, true)} aria-label={`Add ${member.name} to project`}>{busy === member.id ? 'Adding…' : 'Add'}</button>
            </div>)}
          </div>
        </div>}
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <div className="flex justify-end"><button type="button" className="btn-outline" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  );
}

function NewTaskModal({ open, onClose, users, projectId, onCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true); setError('');
    try {
      await api.post(`/api/projects/${projectId}/tasks`, { title: title.trim(), description, priority, assigneeId: assigneeId || null });
      setTitle(''); setDescription(''); setPriority('medium'); setAssigneeId(''); onCreated();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New task">
      <form onSubmit={submit} className="space-y-4">
        <input className="input" autoFocus placeholder="Task title" aria-label="Task title" value={title} onChange={e => setTitle(e.target.value)} required/>
        <textarea className="input" rows={3} placeholder="Add details…" aria-label="Task details" value={description} onChange={e => setDescription(e.target.value)}/>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-muted">Priority<select className="input mt-1" value={priority} onChange={e => setPriority(e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label className="text-sm text-muted">Assignee<select className="input mt-1" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}><option value="">Unassigned</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        </div>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create task'}</button></div>
      </form>
    </Modal>
  );
}
