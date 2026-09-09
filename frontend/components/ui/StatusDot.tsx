export function StatusDot({
  status = 'neutral',
  pulse = false
}: {
  status?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  pulse?: boolean;
}) {
  const classes = ['status-dot', `status-dot-${status}`];
  if (pulse) classes.push('status-dot-pulse');
  return <span className={classes.join(' ')} aria-hidden="true" />;
}
