export default function ProgressBar({ progress, status }) {
  const pct = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;

  return (
    <section className="progress-wrap" aria-live="polite">
      <div className="progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <small>
        Status: <strong>{status}</strong> · {pct}%
      </small>
    </section>
  );
}
