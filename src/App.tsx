import { AlertTriangle, BrainCircuit, Download, FileUp, Gauge, Loader2, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { DrawingPreview } from "./components/DrawingPreview";
import { FeatureList } from "./components/FeatureList";
import { GCodePanel } from "./components/GCodePanel";
import { ParameterPanel } from "./components/ParameterPanel";
import { ThreePreview } from "./components/ThreePreview";
import { AiSettingsPanel } from "./components/AiSettingsPanel";
import { defaultCamParameters, type AnalysisResult, type CamParameters, type ClientAiSettings } from "../shared/schema";
import { analyzeDrawing } from "./lib/analyze";

const defaultAiSettings: ClientAiSettings = {
  provider: "none",
  apiKey: "",
  model: "",
  rememberForSession: false
};

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [params, setParams] = useState<CamParameters>(defaultCamParameters);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [useAi, setUseAi] = useState(true);
  const [aiSettings, setAiSettings] = useState<ClientAiSettings>(loadAiSettings);
  const [isDragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string>("Bereit");
  const [error, setError] = useState<string | null>(null);

  const warnings = useMemo(() => {
    if (!result) return [];
    return Array.from(new Set([...result.analysis.warnings, ...result.gcode.warnings]));
  }, [result]);

  async function analyze(selectedFile = file) {
    if (!selectedFile) return;
    setStatus("Analysiere Zeichnung");
    setError(null);
    try {
      const payload = await analyzeDrawing(selectedFile, params, useAi, aiSettings);
      setResult(payload);
      setStatus(payload.aiUsed ? "KI-Analyse und lokale CAM-Berechnung abgeschlossen" : "Lokale Analyse abgeschlossen");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unbekannter Fehler");
      setStatus("Analyse fehlgeschlagen");
    }
  }

  function pickFile(selected: File | null) {
    if (!selected) return;
    setFile(selected);
    setResult(null);
    void analyze(selected);
  }

  function downloadGCode() {
    if (!result) return;
    const blob = new Blob([result.gcode.text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result.analysis.fileName.replace(/\.[^.]+$/, "") || "program"}.nc`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">2.5D CNC Assistenz</p>
            <h1>Zeichnung prüfen, Werkzeugpfade erzeugen, G-Code exportieren</h1>
          </div>
          <div className="status-pill">
            {status.includes("Analysiere") ? <Loader2 className="spin" size={16} /> : <Gauge size={16} />}
            <span>{status}</span>
          </div>
        </header>

        <section
          className={`dropzone ${isDragging ? "is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            pickFile(event.dataTransfer.files.item(0));
          }}
        >
          <FileUp size={30} />
          <div>
            <strong>{file ? file.name : "DXF, PDF oder Bild hier ablegen"}</strong>
            <span>DXF läuft direkt im Browser; PDF/Bild nutzt optional deinen OpenAI- oder Gemini-Key.</span>
          </div>
          <label className="file-button">
            Datei wählen
            <input
              type="file"
              accept=".dxf,.pdf,.png,.jpg,.jpeg,image/png,image/jpeg,application/pdf"
              onChange={(event) => pickFile(event.target.files?.item(0) ?? null)}
            />
          </label>
          <label className="switch">
            <input type="checkbox" checked={useAi} onChange={(event) => setUseAi(event.target.checked)} />
            <BrainCircuit size={16} />
            KI
          </label>
        </section>

        {error ? (
          <div className="alert critical">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        ) : null}

        {warnings.length ? (
          <div className="alert">
            <AlertTriangle size={18} />
            <span>{warnings[0]}</span>
          </div>
        ) : null}

        <section className="main-grid">
          <div className="preview-stack">
            <DrawingPreview result={result} />
            <ThreePreview result={result} />
          </div>

          <aside className="side-panel">
            <div className="panel-header">
              <Settings2 size={18} />
              <h2>CNC Parameter</h2>
            </div>
            <ParameterPanel params={params} onChange={setParams} onRecalculate={() => analyze()} disabled={!file} />
            <AiSettingsPanel settings={aiSettings} onChange={setAiSettings} />
            <FeatureList result={result} />
          </aside>
        </section>

        <section className="gcode-section">
          <div className="section-title">
            <h2>G-Code</h2>
            <button disabled={!result} onClick={downloadGCode}>
              <Download size={16} />
              Export
            </button>
          </div>
          <GCodePanel result={result} />
        </section>
      </section>
    </main>
  );
}

function loadAiSettings(): ClientAiSettings {
  try {
    const raw = sessionStorage.getItem("cnc-ai-settings");
    if (!raw) return defaultAiSettings;
    const parsed = JSON.parse(raw) as Partial<ClientAiSettings>;
    return {
      ...defaultAiSettings,
      ...parsed,
      provider: parsed.provider === "openai" || parsed.provider === "gemini" ? parsed.provider : "none",
      rememberForSession: true
    };
  } catch {
    return defaultAiSettings;
  }
}
