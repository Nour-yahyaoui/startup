import React, { useEffect, useId } from 'react';
import { Icon } from './Icons.jsx';

export default function Modal({ open, onClose, title, children, size = 'md' }) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={`relative w-full ${sizes[size]} card animate-fade-in flex flex-col max-h-[calc(100dvh-2rem)]`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 id={titleId} className="font-semibold">{title}</h3>
          <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="Close dialog"><Icon name="x" size={18} /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
