import React, { useState, useRef } from 'react';
import { Icon } from './Icons.jsx';
import { api } from '../lib/api.js';
import { useApp } from '../App.jsx';
import { formatBytes } from '../lib/util.js';

export default function FileDropZone({ projectId }) {
  const { toast } = useApp();
  const [drag, setDrag] = useState(false);
  const [uploads, setUploads] = useState([]);
  const inputRef = useRef(null);

  const handleFiles = async (files) => {
    const list = Array.from(files);
    for (const f of list) {
      const id = Math.random().toString(36).slice(2);
      setUploads(u => [...u, { id, name: f.name, size: f.size, progress: 0, status: 'uploading' }]);
      try {
        await api.upload(f, projectId || null);
        setUploads(u => u.map(x => x.id === id ? { ...x, status: 'done', progress: 100 } : x));
        toast(`Uploaded ${f.name}`, 'success');
        setTimeout(() => setUploads(u => u.filter(x => x.id !== id)), 2500);
      } catch (e) {
        setUploads(u => u.map(x => x.id === id ? { ...x, status: 'error', error: e.message } : x));
        toast(`Upload failed: ${f.name}`, 'error');
      }
    }
  };

  return (
    <div
      className={`card p-6 border-dashed transition ${drag ? 'border-primary bg-primary/5' : ''}`}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
    >
      <div className="flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3">
          <Icon name="upload" size={22} />
        </div>
        <div className="font-medium">Drop files here or <button className="text-primary hover:underline" onClick={() => inputRef.current?.click()}>browse</button></div>
        <div className="text-sm text-muted mt-1">Fast uploads · up to 500 MB per file · {projectId ? 'visible to project members and workspace admins' : 'visible to the whole workspace'}</div>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
      </div>

      {uploads.length > 0 && (
        <div className="mt-4 space-y-2">
          {uploads.map(u => (
            <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface2">
              <Icon name={u.status === 'done' ? 'check' : u.status === 'error' ? 'x' : 'file'} size={16}
                className={u.status === 'done' ? 'text-success' : u.status === 'error' ? 'text-danger' : 'text-primary'} />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{u.name}</div>
                <div className="text-xs text-muted">{formatBytes(u.size)}</div>
              </div>
              <div className="text-xs">
                {u.status === 'done' ? 'Done' : u.status === 'error' ? 'Failed' : 'Uploading…'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
