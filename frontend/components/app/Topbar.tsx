'use client';

interface TopbarProps {
  email: string | null;
  onSignOut: () => void;
  onToggleCommandPalette?: () => void;
}

export function Topbar({ email, onSignOut, onToggleCommandPalette }: TopbarProps) {
  return (
    <header
      className="topbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '0 0 20px',
        height: 'var(--topbar-height)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          className="hide-mobile"
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-md)',
            background: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            fontWeight: 700,
            color: '#fff',
          }}
        >
          A
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            AgentOS
          </div>
          <div className="caption hide-mobile">AI Operating Environment</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {onToggleCommandPalette && (
          <button
            className="btn btn-ghost btn-sm hide-mobile"
            onClick={onToggleCommandPalette}
            aria-label="Open command palette"
            title="Command Palette (Ctrl+K)"
          >
            ⌘K
          </button>
        )}
        {email && (
          <span className="muted user-email hide-mobile" title={email}>
            {email}
          </span>
        )}
        <button className="btn btn-secondary btn-sm" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
