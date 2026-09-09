import type { LifecycleState, ToolUsage } from '@/lib/types';

interface AgentActivityProps {
  lifecycle: LifecycleState[];
  tools?: ToolUsage[];
  currentStep: string | null;
}

const STAGE_LABELS: Record<LifecycleState['stage'], string> = {
  understand: 'Understanding',
  plan: 'Planning',
  execute: 'Executing',
  observe: 'Observing',
  verify: 'Verifying',
  deliver: 'Delivering',
};

const STAGE_ICON: Record<LifecycleState['stage'], string> = {
  understand: '◧',
  plan: '◆',
  execute: '▶',
  observe: '◎',
  verify: '✓',
  deliver: '✦',
};

export function AgentActivity({ lifecycle, tools, currentStep }: AgentActivityProps) {
  const hasLifecycle = lifecycle && lifecycle.length > 0;
  const displayLifecycle = hasLifecycle ? lifecycle : buildDefaultLifecycle(currentStep);

  return (
    <div className="task-sidebar-panel">
      <div className="label" style={{ marginBottom: 12 }}>Agent Activity</div>

      <div className="lifecycle-track">
        {displayLifecycle.map((item) => {
          const statusClass = item.status === 'active' ? 'active' : item.status === 'done' ? 'done' : item.status === 'failed' ? 'failed' : '';
          return (
            <div key={item.stage} className={`lifecycle-step ${statusClass}`.trim()}>
              <div className="lifecycle-icon" aria-hidden="true">
                {item.status === 'done' ? '✓' : item.status === 'failed' ? '!' : STAGE_ICON[item.stage]}
              </div>
              <div className="lifecycle-body">
                <div className="lifecycle-title">{item.label}</div>
                {item.detail && <div className="lifecycle-meta">{item.detail}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {tools && tools.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="label" style={{ marginBottom: 8 }}>Tools</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {tools.map((tool) => (
              <span key={tool.name} className={`tool-chip ${tool.active ? 'active' : ''}`}>
                {tool.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function buildDefaultLifecycle(currentStep: string | null): LifecycleState[] {
  const step = currentStep?.toLowerCase() ?? '';
  let activeStage: LifecycleState['stage'] = 'execute';
  if (step.includes('plan')) activeStage = 'plan';
  else if (step.includes('search') || step.includes('inspect')) activeStage = 'execute';
  else if (step.includes('analyz')) activeStage = 'observe';
  else if (step.includes('verif')) activeStage = 'verify';
  else if (step.includes('deliver') || step.includes('complet')) activeStage = 'deliver';
  else if (step.includes('understand')) activeStage = 'understand';

  const stages: LifecycleState[] = [
    { stage: 'understand', status: 'done', label: 'Understanding' },
    { stage: 'plan', status: 'done', label: 'Planning' },
    { stage: 'execute', status: 'done', label: 'Executing' },
    { stage: 'observe', status: 'done', label: 'Observing' },
    { stage: 'verify', status: activeStage === 'verify' ? 'active' : 'done', label: 'Verifying' },
    { stage: 'deliver', status: activeStage === 'deliver' ? 'active' : 'pending', label: 'Delivering' },
  ];

  return stages.map((s) => (s.stage === activeStage ? { ...s, status: 'active' as const, detail: currentStep ?? undefined } : s));
}
