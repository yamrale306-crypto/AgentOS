'use client';

import { useState } from 'react';

const PLACEHOLDER =
  'Example: Research the best AI note-taking apps for students in India and give me a comparison with sources.';

interface TaskComposerProps {
  onSubmit: (prompt: string) => Promise<void>;
}

export function TaskComposer({ onSubmit }: TaskComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (busy || trimmed.length < 3) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
      setPrompt('');
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
      <div className="actions composer-actions">
        <button className="btn" type="submit" disabled={busy || prompt.trim().length < 3}>
          {busy ? 'Starting…' : 'Run Agent'}
        </button>
        <span className="muted char-count">{prompt.length}/4000</span>
      </div>
    </form>
  );
}