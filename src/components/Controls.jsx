export default function Controls({
  preset,
  setPreset,
  removeEnding,
  setRemoveEnding,
  dynamicDetection,
  setDynamicDetection,
}) {
  return (
    <section className="controls">
      <label>
        Processing profile
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="speed">Speed (fastest)</option>
          <option value="balanced">Balanced</option>
          <option value="quality">Quality (slower)</option>
        </select>
      </label>

      <label className="check">
        <input type="checkbox" checked={removeEnding} onChange={(e) => setRemoveEnding(e.target.checked)} />
        Auto-trim ending watermark (last 2.5s)
      </label>

      <label className="check">
        <input type="checkbox" checked={dynamicDetection} onChange={(e) => setDynamicDetection(e.target.checked)} />
        Dynamic detection (only if logo position changes)
      </label>
    </section>
  );
}
