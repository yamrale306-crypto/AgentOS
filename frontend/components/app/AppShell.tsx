'use client';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { CommandPalette } from '@/components/CommandPalette';

interface AppShellProps {
  email: string | null;
  onSignOut: () => void;
  children: React.ReactNode;
}

const MOBILE_NAV = [
  { href: '/', label: 'Home', icon: '⌂' },
  { href: '/tasks', label: 'Tasks', icon: '☰' },
  { href: '/projects', label: 'Projects', icon: '◧' },
  { href: '/artifacts', label: 'Artifacts', icon: '◆' },
  { href: '/history', label: 'More', icon: '⋮' },
];

export function AppShell({ email, onSignOut, children }: AppShellProps) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  useEffect(() => {
    function handleShortcut(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
    }
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Topbar
          email={email}
          onSignOut={onSignOut}
          onToggleCommandPalette={() => setCommandPaletteOpen((v) => !v)}
        />
        <main className="app-content">{children}</main>
      </div>

      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <div className="mobile-nav-inner">
          {MOBILE_NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <button
                key={item.href}
                className={`mobile-nav-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => router.push(item.href)}
              >
                <span className="mobile-nav-icon" aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
