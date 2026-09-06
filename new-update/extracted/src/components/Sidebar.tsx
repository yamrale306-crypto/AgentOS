import {
  Sparkles,
  Compass,
  History,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Radio,
  X,
  Shield,
  Layers
} from 'lucide-react';
import type { ViewMode } from '../types';

interface SidebarProps {
  activeView: ViewMode;
  onSelectView: (view: ViewMode) => void;
  onNewResearch: () => void;
  activeTasksCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  email: string | null;
}

export function Sidebar({
  activeView,
  onSelectView,
  onNewResearch,
  activeTasksCount,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  email
}: SidebarProps) {
  const navItems = [
    {
      id: 'composer' as ViewMode,
      label: 'New Research',
      icon: Plus,
      badge: null
    },
    {
      id: 'tasks' as ViewMode,
      label: 'Research / Tasks',
      icon: Compass,
      badge: activeTasksCount > 0 ? `${activeTasksCount} active` : null,
      badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30'
    },
    {
      id: 'history' as ViewMode,
      label: 'History',
      icon: History,
      badge: null
    },
    {
      id: 'settings' as ViewMode,
      label: 'System & API',
      icon: SettingsIcon,
      badge: null
    }
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-950 border-r border-slate-800/80 select-none">
      {/* Brand Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800/80">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold shadow-md shadow-blue-500/20 shrink-0">
            <Radio size={16} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm text-slate-100 tracking-tight font-mono">
                  AgentOS
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  v1.0
                </span>
              </div>
              <div className="text-[10px] text-slate-400 truncate">Autonomous Research</div>
            </div>
          )}
        </div>

        {/* Desktop collapse toggle button */}
        <button
          id="desktop-collapse-sidebar-btn"
          type="button"
          onClick={onToggleCollapse}
          className="hidden md:flex p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>

        {/* Mobile close button */}
        <button
          id="mobile-close-sidebar-btn"
          type="button"
          onClick={onCloseMobile}
          className="md:hidden p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
          title="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* Primary Action Button: New Research */}
      <div className="p-3">
        <button
          id="sidebar-new-research-btn"
          type="button"
          onClick={() => {
            onNewResearch();
            onCloseMobile();
          }}
          className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg font-medium text-xs transition-all duration-150 cursor-pointer ${
            collapsed
              ? 'px-2 bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
              : 'px-3 bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-500/15'
          }`}
          title="Start New Research"
        >
          <Plus size={15} className="shrink-0" />
          {!collapsed && <span>New Research</span>}
        </button>
      </div>

      {/* Navigation list */}
      <nav className="flex-1 px-2 py-1 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              key={item.id}
              id={`nav-item-${item.id}`}
              type="button"
              onClick={() => {
                onSelectView(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                collapsed ? 'justify-center px-2' : 'justify-between'
              } ${
                isActive
                  ? 'bg-slate-850 text-blue-400 border border-slate-750 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Icon size={16} className={`shrink-0 ${isActive ? 'text-blue-400' : 'text-slate-400'}`} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </div>

              {!collapsed && item.badge && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full border ${
                    item.badgeColor || 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer Profile / Meta */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950">
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0">
              {email ? email.slice(0, 1).toUpperCase() : 'A'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-slate-200 truncate">
                {email || 'Research Guest'}
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                {email ? 'Authenticated' : 'Sandbox Session'}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <div
              className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-300"
              title={email || 'Research Guest'}
            >
              {email ? email.slice(0, 1).toUpperCase() : 'A'}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside
        id="app-desktop-sidebar"
        className={`hidden md:block transition-all duration-200 shrink-0 ${
          collapsed ? 'w-16' : 'w-56'
        }`}
      >
        <div className="sticky top-0 h-screen">{sidebarContent}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Backdrop */}
          <div
            id="mobile-drawer-backdrop"
            onClick={onCloseMobile}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
          />
          {/* Drawer panel */}
          <div className="relative w-64 max-w-[80vw] h-full shadow-2xl z-10">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
