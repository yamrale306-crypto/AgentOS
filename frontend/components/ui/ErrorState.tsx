export function ErrorState({
  message,
  onRetry
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="card"
      style={{
        background: 'var(--error-soft)',
        borderColor: 'var(--error)',
        padding: '16px 20px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 20 }}>⚠️</div>
        <div style={{ flex: 1 }}>
          <div
            className="heading-3"
            style={{ color: 'var(--error)', marginBottom: 2 }}
          >
            Something went wrong
          </div>
          <div className="muted">{message}</div>
        </div>
        {onRetry && (
          <button className="btn btn-sm btn-secondary" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
