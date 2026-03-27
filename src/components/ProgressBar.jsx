export default function ProgressBar({ progress, status }) {
  return (
    <section className="progress-wrap" aria-live="polite">
      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${progress}%` }} />
      </div>
      <small>Status: {status}</small>
    </section>
  );
}
