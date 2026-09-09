'use client';

import { useState } from 'react';
import { useAgentOS } from '@/lib/useAgentOS';
import { AuthGate } from '@/components/AuthGate';
import { SystemDashboard } from '@/components/SystemDashboard';
import { ErrorState } from '@/components/ui/ErrorState';

export default function SystemPage() {
  const os = useAgentOS();
  const [banner, setBanner] = useState<string | null>(null);
  const { api } = os;

  return (
    <AuthGate os={os}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="display" style={{ marginBottom: 8 }}>System</h1>
        <p className="body" style={{ maxWidth: 600 }}>
          Live model routing, provider health, token rotation, and diagnostic tools.
        </p>
      </div>

      {banner && (
        <div style={{ marginBottom: 20 }}>
          <ErrorState message={banner} />
        </div>
      )}

      {api && <SystemDashboard api={api} onError={setBanner} />}
    </AuthGate>
  );
}
