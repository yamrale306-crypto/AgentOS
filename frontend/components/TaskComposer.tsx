'use client';

import { useState } from 'react';
import type { ModelMode } from '@/lib/types';

const PLACEHOLDER =
  'Example: Research the best AI note-taking apps for students in India and give me a comparison with sources.';

const MODE_OPTIONS: Array<{ value: ModelMode; label: string; hint: string }> = [
  { value: 'auto', label: 'Auto', hint: 'Let the router pick per stage' },
  { value: 'quality', label: 'Quality', hint: 'Best reasoning, slower' },
  { value: 'balanced', label: 'Balanced', hint: 'Quality and speed trade-off' },
  { value: 'fast', label: 'Fast', hint: 'Speed first' },
  { value: 'lowcost', label: 'Low cost', hint: 'Cheapest capable model' }
];

interface TaskComposerProps {
  onSubmit: (prompt: string, options: { mode: ModelMode; model: string | null }) => Promise<void>;
}

export function TaskComposer({ onSubmit }: TaskComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<ModelMode>('auto');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (busy || trimmed.length < 3) return;
    setBusy(true);
    try {
      await onSubmit(trimmed, { mode, model: model.trim() || null });
      setPrompt('');
      setModel('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={PLACEHOLDER}
        maxLength={4000}
        style={{
          minHeight: 120,
          marginBottom: 12,
          background: 'var(--surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text)',
          padding: '12px 14px',
          fontSize: 14,
          lineHeight: 1.6,
        }}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
          <span className="label">Mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ModelMode)}
            aria-label="Model mode"
            style={{
              width: 'auto',
              minWidth: 140,
              background: 'var(--surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text)',
              padding: '8px 32px 8px 12px',
              fontSize: 13,
              appearance: 'none',
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7687' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
              cursor: 'pointer',
            }}
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} title={option.hint}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-secondary)', flex: 1, minWidth: 180 }}>
          <span className="label">Model override (optional)</span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. deepseek/deepseek-chat"
            maxLength={200}
            aria-label="Model override"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text)',
              padding: '8px 12px',
              fontSize: 13,
            }}
          />
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={busy || prompt.trim().length < 3}
          style={{ minWidth: 140 }}
        >
          {busy ? 'Starting…' : 'Run →'}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>{prompt.length}/4000</span>
      </div>
    </form>
  );
}
