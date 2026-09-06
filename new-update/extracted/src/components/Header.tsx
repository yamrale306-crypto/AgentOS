import { Menu, User, LogOut, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import type { ViewMode } from '../types';

interface HeaderProps {
  email: string | null;
  activeView: ViewMode;
  onSignOut: () => void;
  onOpenSettings: () => void;
  onToggleSidebar?: () => void;
  backendHealthy: boolean;
}

export function Header({
  email,
  activeView,
  onSignOut,
  onOpenSettings,
  onToggleSidebar,
  backendHealthy
}: HeaderProps) {
  const viewTitles: Record<ViewMode, string> = {
    composer: 'New Investigation',
    tasks: 'Active Investigations',
    history: 'Research Archive',
    settings: 'System & Connectivity'
  };

  return (
    <header
      id="app-top-header"
      className="sticky top-0 z-30 h-14 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between gap-4"
    >
      <div className="flex items-center gap-3">
        {onToggleSidebar && (
          <button
            id="mobile-sidebar-toggle-btn"
            type="button"
            onClick={onToggleSidebar}
            className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
            aria-label="Toggle navigation menu"
          >
            <Menu size={18} />
          </button>
        )}

        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-100 tracking-tight">
            {viewTitles[activeView]}
          </span>
          <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-slate-700" />
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 font-mono">
            <span
              className={`w-2 h-2 rounded-full ${
                backendHealthy ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
              }`}
            />
            <span>{backendHealthy ? 'Agent Online' : 'Local Sandbox'}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        {email ? (
          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300">
              <User size={13} className="text-slate-400" />
              <span className="max-w-[170px] truncate">{email}</span>
            </div>

            <button
              id="header-settings-btn"
              type="button"
              onClick={onOpenSettings}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors cursor-pointer"
              title="Settings & System Status"
              aria-label="Settings"
            >
              <SettingsIcon size={16} />
            </button>

            <button
              id="header-signout-btn"
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-rose-300 hover:bg-rose-500/10 border border-slate-800 hover:border-rose-500/30 transition-colors cursor-pointer"
              title="Sign out of AgentOS"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        ) : (
          <button
            id="header-settings-guest-btn"
            type="button"
            onClick={onOpenSettings}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors cursor-pointer"
            title="Configure System & API"
            aria-label="Settings"
          >
            <SettingsIcon size={16} />
          </button>
        )}
      </div>
    </header>
  );
}
