export default function ProgressBar({ progress, status }) {
  return (
    <section className="progress-wrap" aria-live="polite">
      <div className="progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-bar" style={{ width: `${progress}%` }} />
      </div>
      <small>
        Status: <strong>{status}</strong> · {progress}%
      </small>
    </section>
  );
}
