'use client';

import { useAgentOS } from '@/lib/useAgentOS';
import { AuthGate } from '@/components/AuthGate';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/ui/EmptyState';

export default function ProjectsPage() {
  const os = useAgentOS();
  const router = useRouter();

  return (
    <AuthGate os={os}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="display" style={{ marginBottom: 8 }}>Projects</h1>
        <p className="body" style={{ maxWidth: 600 }}>
          Group related tasks, files, and artifacts into persistent workspaces.
        </p>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '40px 24px' }}>
          <EmptyState
            title="Projects are not available yet"
            message="The current backend stores research tasks individually. Persistent project containers are a planned feature — for now, use the Tasks page to organize and track your work."
          />
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button className="btn btn-primary" onClick={() => router.push('/tasks')}>
              Go to Tasks
            </button>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}