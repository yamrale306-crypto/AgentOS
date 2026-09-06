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
      />
      <div className="composer-options">
        <label className="composer-field">
          <span className="muted">Mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as ModelMode)} aria-label="Model mode">
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} title={option.hint}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="muted composer-hint">
            {MODE_OPTIONS.find((option) => option.value === mode)?.hint}
          </span>
        </label>
        <label className="composer-field">
          <span className="muted">Model override (optional)</span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. deepseek/deepseek-chat"
            maxLength={200}
            aria-label="Model override"
          />
        </label>
      </div>
      <div className="actions composer-actions">
        <button className="btn" type="submit" disabled={busy || prompt.trim().length < 3}>
          {busy ? 'Starting…' : 'Run Agent'}
        </button>
        <span className="muted char-count">{prompt.length}/4000</span>
      </div>
    </form>
  );
}