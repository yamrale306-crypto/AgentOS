'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home', icon: '⌂' },
  { href: '/tasks', label: 'Tasks', icon: '☰' },
  { href: '/projects', label: 'Projects', icon: '◧' },
  { href: '/artifacts', label: 'Artifacts', icon: '◆' },
  { href: '/history', label: 'History', icon: '🕐' },
  { href: '/system', label: 'System', icon: '⚙' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <aside className={`app-sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: 'var(--sidebar-width)',
          borderRight: '1px solid var(--border)',
          background: 'var(--surface)',
          padding: '16px 0',
        }}
      >
        <div
          style={{
            padding: '0 20px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
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
                  flexShrink: 0,
                }}
              >
                A
              </div>
              <div className="sidebar-brand-text">
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 16,
                    letterSpacing: '-0.02em',
                    lineHeight: 1.2,
                  }}
                >
                  AgentOS
                </div>
                <div className="caption" style={{ marginTop: 1 }}>
                  AI Operating Environment
                </div>
              </div>
            </div>
            <button
              className="btn btn-icon btn-ghost hide-mobile"
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              {collapsed ? '→' : '←'}
            </button>
          </div>
        </div>

        <nav
          className="sidebar-nav"
          style={{
            flex: 1,
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className="nav-item"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: active ? 500 : 400,
                  transition: 'all 120ms ease',
                  width: '100%',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'var(--surface-hover)';
                    e.currentTarget.style.color = 'var(--text)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }
                }}
              >
                <span className="nav-icon" style={{ fontSize: 18, flexShrink: 0 }}>
                  {item.icon}
                </span>
                <span className="nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div
          style={{
            padding: '12px 16px 0',
            borderTop: '1px solid var(--border-subtle)',
            marginTop: 'auto',
          }}
        >
          <div className="caption" style={{ padding: '0 4px' }}>
            AgentOS v1.0
          </div>
        </div>
      </div>
    </aside>
  );
}

