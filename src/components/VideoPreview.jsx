export default function VideoPreview({ inputPreviewUrl, outputUrl }) {
  return (
    <section className="preview-grid">
      <article className="card">
        <h2>Original</h2>
        {inputPreviewUrl ? <video controls src={inputPreviewUrl} /> : <p>No input selected.</p>}
      </article>
      <article className="card">
        <h2>Processed</h2>
        {outputUrl ? (
          <>
            <video controls src={outputUrl} />
            <a href={outputUrl} download="output.mp4" className="download-link">
              Download output.mp4
            </a>
          </>
        ) : (
          <p>Process a file to preview output.</p>
        )}
      </article>
    </section>
  );
}
