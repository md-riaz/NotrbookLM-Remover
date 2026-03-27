import { useRef } from 'react';

export default function UploadBox({ fileLabel, onFileSelect }) {
  const fileInputRef = useRef(null);

  return (
    <label
      className="upload-box"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.key === ' ') e.preventDefault();
          fileInputRef.current?.click();
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onFileSelect(e.dataTransfer.files?.[0]);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp4,video/mp4"
        onChange={(e) => onFileSelect(e.target.files?.[0])}
        hidden
      />
      <span className="upload-title">Drop an MP4 file or click to choose</span>
      <small>{fileLabel}</small>
    </label>
  );
}
