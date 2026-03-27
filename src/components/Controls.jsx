export default function Controls({ preset, setPreset, removeEnding, setRemoveEnding, dynamicDetection, setDynamicDetection }) {
  return (
    <section className="controls">
      <label>
        Preset
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="speed">speed</option>
          <option value="balanced">balanced</option>
          <option value="quality">quality</option>
        </select>
      </label>

      <label className="check">
        <input type="checkbox" checked={removeEnding} onChange={(e) => setRemoveEnding(e.target.checked)} />
        Remove ending watermark (last 2.5s)
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={dynamicDetection}
          onChange={(e) => setDynamicDetection(e.target.checked)}
        />
        Dynamic detection (optional)
      </label>
    </section>
  );
}
