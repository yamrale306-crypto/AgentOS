interface HeaderProps {
  email: string | null;
  onSignOut: () => void;
}

export function Header({ email, onSignOut }: HeaderProps) {
  return (
    <div className="topbar">
      <div>
        <div className="brand">AgentOS</div>
        <div className="tagline">Autonomous web research agent</div>
      </div>
      <div className="topbar-actions">
        {email && <span className="muted user-email">{email}</span>}
        <button className="btn secondary" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}