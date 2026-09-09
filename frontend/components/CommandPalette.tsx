'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface CommandItem {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  shortcut?: string;
  href?: string;
  category?: 'navigation' | 'task' | 'system';
}

const COMMANDS: CommandItem[] = [
  { id: 'home', title: 'Go to Home', description: 'Return to the main workspace', icon: '⌂', category: 'navigation', href: '/' },
  { id: 'tasks', title: 'Open Tasks', description: 'View all tasks', icon: '☰', category: 'navigation', href: '/tasks' },
  { id: 'projects', title: 'Open Projects', description: 'Manage projects', icon: '◧', category: 'navigation', href: '/projects' },
  { id: 'artifacts', title: 'Open Artifacts', description: 'Browse artifacts and results', icon: '◆', category: 'navigation', href: '/artifacts' },
  { id: 'history', title: 'Open History', description: 'View task history', icon: '🕐', category: 'navigation', href: '/history' },
  { id: 'system', title: 'Open System', description: 'System settings and diagnostics', icon: '⚙', category: 'navigation', href: '/system' },
  { id: 'new-task', title: 'New Task', description: 'Create a new task', icon: '✦', shortcut: 'Ctrl+N', category: 'task', href: '/' },
  { id: 'retry', title: 'Retry Task', description: 'Retry the current task', icon: '↻', category: 'task', href: '/' },
  { id: 'stop', title: 'Stop Task', description: 'Cancel the running task', icon: '■', category: 'task', href: '/' },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const navigate = (href: string) => {
    router.push(href);
    onClose();
  };

  const run = (cmd: CommandItem | undefined) => {
    if (!cmd) return;
    if (cmd.href) navigate(cmd.href);
    else onClose();
  };

  const filtered = COMMANDS.filter((cmd) => {
    const q = query.toLowerCase();
    if (!q) return true;
    return (
      cmd.title.toLowerCase().includes(q) ||
      (cmd.description && cmd.description.toLowerCase().includes(q)) ||
      (cmd.category && cmd.category.toLowerCase().includes(q))
    );
  });

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        run(filtered[selectedIndex]);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, filtered, selectedIndex, onClose]);

  if (!open) return null;

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-panel" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmd-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a command or search..."
          aria-label="Command palette"
        />
        <div className="cmd-list" role="listbox">
          {filtered.length === 0 && (
            <div className="cmd-item" style={{ cursor: 'default', color: 'var(--text-muted)' }}>
              <span className="cmd-item-title">No results</span>
            </div>
          )}
          {filtered.map((cmd, index) => (
            <button
              key={cmd.id}
              role="option"
              aria-selected={index === selectedIndex}
              className={`cmd-item ${index === selectedIndex ? 'focused' : ''}`}
              onClick={() => {
                run(cmd);
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span style={{ width: 24, textAlign: 'center', fontSize: 16 }}>{cmd.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cmd-item-title">{cmd.title}</div>
                {cmd.description && <div className="cmd-item-desc">{cmd.description}</div>}
              </div>
              {cmd.shortcut && <span className="caption">{cmd.shortcut}</span>}
            </button>
          ))}
        </div>
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="caption">↑↓ to navigate</span>
          <span className="caption">↵ to select</span>
          <span className="caption">esc to close</span>
        </div>
      </div>
    </div>
  );
}
