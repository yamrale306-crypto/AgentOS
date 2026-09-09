export function EmptyState({
  message,
  title = 'Nothing here yet'
}: {
  message: string;
  title?: string;
}) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
      <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>📭</div>
      <div className="heading-3" style={{ marginBottom: 6 }}>{title}</div>
      <div className="muted">{message}</div>
    </div>
  );
}
