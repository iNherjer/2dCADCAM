import { calculateBounds } from "../../shared/geometry";
import type { ClientAiSettings, DrawingAnalysis, GeometryEntity, MachiningFeature, Unit } from "../../shared/schema";

const aiPrompt =
  "Analysiere diese technische Zeichnung fuer 2.5D-Fraesen. Extrahiere Einheiten, Massstab, 2D-Geometrie, Bohrungen, Konturen, Taschen und Unsicherheiten. Koordinaten sollen in Millimetern im Zeichnungskoordinatensystem liegen. Gib ausschliesslich JSON im vorgegebenen Schema zurueck. Erfinde keine sicheren Masse, wenn sie nicht lesbar sind.";

export async function analyzeWithByokAi(file: File, settings: ClientAiSettings): Promise<DrawingAnalysis> {
  if (!settings.apiKey.trim()) throw new Error("Bitte zuerst einen API-Key fuer die KI-Analyse eingeben.");
  const raw = settings.provider === "gemini" ? await callGemini(file, settings) : await callOpenAi(file, settings);
  return normalizeAiAnalysis(raw, file.name, settings.provider);
}

async function callOpenAi(file: File, settings: ClientAiSettings): Promise<unknown> {
  const dataUrl = await fileToDataUrl(file);
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const mediaPart = isPdf
    ? { type: "input_file", filename: file.name, file_data: dataUrl }
    : { type: "input_image", image_url: dataUrl, detail: "high" };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey.trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.model || "gpt-5.5",
      input: [
        {
          role: "system",
          content: "Du bist ein vorsichtiger CNC-Zeichnungsanalyst. Keine G-Code-Erzeugung, nur strukturierte Geometrie."
        },
        {
          role: "user",
          content: [{ type: "input_text", text: aiPrompt }, mediaPart]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "cnc_drawing_analysis",
          strict: false,
          schema: drawingAnalysisJsonSchema
        }
      }
    })
  });

  if (!response.ok) throw new Error(await readableApiError(response, "OpenAI"));
  return JSON.parse(extractOpenAiText(await response.json()));
}

async function callGemini(file: File, settings: ClientAiSettings): Promise<unknown> {
  const base64 = await fileToBase64(file);
  const mimeType = file.type || inferMimeType(file.name);
  const model = settings.model || "gemini-2.5-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": settings.apiKey.trim()
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: aiPrompt },
            { inlineData: { mimeType, data: base64 } }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: geminiResponseSchema
      }
    })
  });

  if (!response.ok) throw new Error(await readableApiError(response, "Gemini"));
  return JSON.parse(stripJsonFence(extractGeminiText(await response.json())));
}

function normalizeAiAnalysis(raw: unknown, fileName: string, provider: ClientAiSettings["provider"]): DrawingAnalysis {
  const source = asRecord(raw);
  const entities = sanitizeEntities(asArray(source.entities));
  const features = sanitizeFeatures(asArray(source.features));
  return {
    source: "ai-assisted",
    fileName,
    units: sanitizeUnit(source.units),
    scale: typeof source.scale === "number" && source.scale > 0 ? source.scale : 1,
    entities,
    features,
    uncertainties: asArray(source.uncertainties).map((item, index) => {
      const uncertainty = asRecord(item);
      return {
        id: String(uncertainty.id ?? `ai-uncertainty-${index + 1}`),
        severity: uncertainty.severity === "critical" || uncertainty.severity === "info" ? uncertainty.severity : "warning",
        message: String(uncertainty.message ?? "KI-Analyse enthaelt eine unklare Stelle."),
        suggestedAction: uncertainty.suggestedAction === undefined ? undefined : String(uncertainty.suggestedAction)
      };
    }),
    warnings: [
      `BYOK-${provider === "openai" ? "OpenAI" : "Gemini"}-Analyse: Ergebnisse vor Maschinenlauf pruefen.`,
      ...asArray(source.warnings).map(String)
    ],
    bounds: calculateBounds(entities)
  };
}

function sanitizeEntities(values: unknown[]): GeometryEntity[] {
  const entities: GeometryEntity[] = [];
  values.forEach((value, index) => {
    const entity = asRecord(value);
    const id = String(entity.id ?? `ai-geo-${index + 1}`);
    const layer = entity.layer === undefined ? undefined : String(entity.layer);
    if (entity.type === "line") {
      const start = point(entity.start);
      const end = point(entity.end);
      if (start && end) entities.push({ id, type: "line", layer, start, end });
    }
    if (entity.type === "circle") {
      const center = point(entity.center);
      const radius = number(entity.radius);
      if (center && radius > 0) entities.push({ id, type: "circle", layer, center, radius });
    }
    if (entity.type === "arc") {
      const center = point(entity.center);
      const radius = number(entity.radius);
      if (center && radius > 0) {
        entities.push({
          id,
          type: "arc",
          layer,
          center,
          radius,
          startAngleDeg: number(entity.startAngleDeg),
          endAngleDeg: number(entity.endAngleDeg)
        });
      }
    }
    if (entity.type === "polyline") {
      const points = asArray(entity.points).map(point).filter((item) => item !== null);
      if (points.length > 1) entities.push({ id, type: "polyline", layer, points, closed: Boolean(entity.closed) });
    }
  });
  return entities;
}

function sanitizeFeatures(values: unknown[]): MachiningFeature[] {
  const features: MachiningFeature[] = [];
  values.forEach((value, index) => {
    const feature = asRecord(value);
    const id = String(feature.id ?? `ai-feature-${index + 1}`);
    const label = String(feature.label ?? feature.type ?? "Feature");
    const geometryEntityIds = asArray(feature.geometryEntityIds).map(String);
    const depthMm = Math.max(0.1, number(feature.depthMm, 1));
    const confidence = clamp(number(feature.confidence, 0.5), 0, 1);

    if (feature.type === "drill") {
      const center = point(feature.center);
      const diameterMm = number(feature.diameterMm);
      if (center && diameterMm > 0) features.push({ id, type: "drill", label, geometryEntityIds, center, diameterMm, depthMm, confidence });
    } else if (feature.type === "profile" || feature.type === "pocket") {
      const side = feature.side === "inside" || feature.side === "center" ? feature.side : "outside";
      features.push({ id, type: feature.type, label, geometryEntityIds, depthMm, side, confidence });
    } else if (feature.type === "engrave") {
      features.push({ id, type: "engrave", label, geometryEntityIds, depthMm, confidence });
    }
  });
  return features;
}

function extractOpenAiText(payload: unknown): string {
  const object = asRecord(payload);
  if (typeof object.output_text === "string") return object.output_text;
  const texts = asArray(object.output).flatMap((item) =>
    asArray(asRecord(item).content).flatMap((part) => {
      const text = asRecord(part).text;
      return typeof text === "string" ? [text] : [];
    })
  );
  if (!texts.length) throw new Error("OpenAI-Antwort enthaelt keinen JSON-Text.");
  return texts.join("\n");
}

function extractGeminiText(payload: unknown): string {
  const candidates = asArray(asRecord(payload).candidates);
  const first = asRecord(candidates[0]);
  const parts = asArray(asRecord(first.content).parts);
  const texts = parts.flatMap((part) => {
    const text = asRecord(part).text;
    return typeof text === "string" ? [text] : [];
  });
  if (!texts.length) throw new Error("Gemini-Antwort enthaelt keinen JSON-Text.");
  return texts.join("\n");
}

async function readableApiError(response: Response, provider: string): Promise<string> {
  const text = await response.text();
  return `${provider}-Analyse fehlgeschlagen (${response.status}): ${text.slice(0, 500)}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function fileToBase64(file: File): Promise<string> {
  return (await fileToDataUrl(file)).split(",")[1] ?? "";
}

function inferMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function stripJsonFence(text: string): string {
  return text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function sanitizeUnit(value: unknown): Unit {
  return value === "mm" || value === "inch" || value === "unknown" ? value : "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function point(value: unknown) {
  const candidate = asRecord(value);
  const x = number(candidate.x, Number.NaN);
  const y = number(candidate.y, Number.NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const drawingAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    units: { enum: ["mm", "inch", "unknown"] },
    scale: { type: "number" },
    entities: { type: "array", items: { type: "object", additionalProperties: true } },
    features: { type: "array", items: { type: "object", additionalProperties: true } },
    uncertainties: { type: "array", items: { type: "object", additionalProperties: true } },
    warnings: { type: "array", items: { type: "string" } }
  },
  required: ["units", "scale", "entities", "features", "uncertainties", "warnings"]
};

const geminiResponseSchema = {
  type: "OBJECT",
  properties: {
    units: { type: "STRING" },
    scale: { type: "NUMBER" },
    entities: { type: "ARRAY", items: { type: "OBJECT" } },
    features: { type: "ARRAY", items: { type: "OBJECT" } },
    uncertainties: { type: "ARRAY", items: { type: "OBJECT" } },
    warnings: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["units", "scale", "entities", "features", "uncertainties", "warnings"]
};
