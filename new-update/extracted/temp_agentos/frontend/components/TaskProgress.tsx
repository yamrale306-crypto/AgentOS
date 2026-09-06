interface TaskProgressProps {
  currentStep: string | null;
}

export function TaskProgress({ currentStep }: TaskProgressProps) {
  return (
    <div className="progress-wrap">
      <p className="muted">{currentStep || 'Working…'}</p>
      <div className="progress" role="progressbar" aria-label={currentStep || 'Working'}>
        <div className="progress-bar" />
      </div>
    </div>
  );
}