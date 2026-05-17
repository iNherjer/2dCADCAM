import { RefreshCw } from "lucide-react";
import type { CamParameters } from "../../shared/schema";

type Props = {
  params: CamParameters;
  disabled: boolean;
  onChange: (params: CamParameters) => void;
  onRecalculate: () => void;
};

const numericFields: Array<{ key: keyof CamParameters; label: string; min: number; step: number; suffix: string }> = [
  { key: "toolDiameterMm", label: "Werkzeug", min: 0.1, step: 0.1, suffix: "mm" },
  { key: "stockThicknessMm", label: "Material", min: 0.1, step: 0.5, suffix: "mm" },
  { key: "cutDepthMm", label: "Tiefe", min: 0.1, step: 0.1, suffix: "mm" },
  { key: "stepDownMm", label: "Zustellung", min: 0.1, step: 0.1, suffix: "mm" },
  { key: "feedRateMmMin", label: "Vorschub", min: 1, step: 10, suffix: "mm/min" },
  { key: "plungeRateMmMin", label: "Eintauchen", min: 1, step: 10, suffix: "mm/min" },
  { key: "spindleRpm", label: "Spindel", min: 0, step: 500, suffix: "rpm" },
  { key: "safeZMm", label: "Safe Z", min: 0.1, step: 0.5, suffix: "mm" }
];

export function ParameterPanel({ params, disabled, onChange, onRecalculate }: Props) {
  function setNumber(key: keyof CamParameters, value: string) {
    onChange({ ...params, [key]: Number(value) });
  }

  return (
    <div className="parameter-grid">
      {numericFields.map((field) => (
        <label className="field" key={field.key}>
          <span>{field.label}</span>
          <div className="input-row">
            <input
              type="number"
              min={field.min}
              step={field.step}
              value={String(params[field.key])}
              onChange={(event) => setNumber(field.key, event.target.value)}
            />
            <small>{field.suffix}</small>
          </div>
        </label>
      ))}

      <label className="field">
        <span>Post</span>
        <select value={params.postProcessor} onChange={(event) => onChange({ ...params, postProcessor: event.target.value as CamParameters["postProcessor"] })}>
          <option value="grbl">GRBL</option>
          <option value="linuxcnc">LinuxCNC</option>
        </select>
      </label>

      <label className="check-row">
        <input type="checkbox" checked={params.tabsEnabled} onChange={(event) => onChange({ ...params, tabsEnabled: event.target.checked })} />
        Haltestege
      </label>

      <button className="wide-button" disabled={disabled} onClick={onRecalculate}>
        <RefreshCw size={16} />
        Neu berechnen
      </button>
    </div>
  );
}
