export default function UploadBox({ fileLabel, onFileSelect }) {
  return (
    <label
      className="upload-box"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onFileSelect(e.dataTransfer.files?.[0]);
      }}
    >
      <input type="file" accept=".mp4,video/mp4" onChange={(e) => onFileSelect(e.target.files?.[0])} hidden />
      <span className="upload-title">Drop an MP4 file or click to choose</span>
      <small>{fileLabel}</small>
    </label>
  );
}
