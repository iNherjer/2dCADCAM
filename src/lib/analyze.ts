import { buildToolpaths, generateGCode } from "../../shared/cam";
import { calculateBounds } from "../../shared/geometry";
import { parseDxf } from "../../shared/dxf";
import { analyzeWithByokAi } from "./byokAi";
import type { AnalysisResult, CamParameters, ClientAiSettings, DrawingAnalysis } from "../../shared/schema";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;

export async function analyzeDrawing(file: File, params: CamParameters, useAi: boolean, aiSettings: ClientAiSettings): Promise<AnalysisResult> {
  if (apiBaseUrl) return analyzeViaApi(file, params, useAi, apiBaseUrl);
  return analyzeLocally(file, params, useAi, aiSettings);
}

async function analyzeViaApi(file: File, params: CamParameters, useAi: boolean, baseUrl: string): Promise<AnalysisResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("useAi", String(useAi));
  form.append("camParameters", JSON.stringify(params));
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/analyze`, { method: "POST", body: form });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Analyse fehlgeschlagen");
  return payload;
}

async function analyzeLocally(file: File, params: CamParameters, useAi: boolean, aiSettings: ClientAiSettings): Promise<AnalysisResult> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const analysis =
    extension === "dxf"
      ? parseDxf(await file.text(), file.name)
      : useAi && aiSettings.provider !== "none"
        ? await analyzeWithByokAi(file, aiSettings)
        : buildStaticUnstructuredAnalysis(file);
  const toolpaths = buildToolpaths(analysis, params);
  const gcode = generateGCode(analysis, params, toolpaths);
  return {
    analysis,
    camParameters: params,
    toolpaths,
    gcode,
    aiUsed: false
  };
}

function buildStaticUnstructuredAnalysis(file: File): DrawingAnalysis {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  return {
    source: isPdf ? "local-pdf" : "local-image",
    fileName: file.name,
    units: "unknown",
    scale: 1,
    entities: [],
    features: [],
    uncertainties: [
      {
        id: "backend-required",
        severity: "warning",
        message: "Die GitHub-Pages-Version kann PDF/Bild nicht mit KI analysieren, weil API-Keys nicht im Browser gespeichert werden dürfen.",
        suggestedAction: "DXF verwenden oder VITE_API_BASE_URL auf ein eigenes Backend setzen."
      }
    ],
    warnings: ["Statischer Modus: Nur DXF wird lokal in Geometrie umgewandelt."],
    bounds: calculateBounds([])
  };
}
