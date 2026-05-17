import { calculateBounds } from "../shared/geometry";
import type { DrawingAnalysis, GeometryEntity, MachiningFeature, Unit } from "../shared/schema";

type AiAnalysisInput = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  fallback: DrawingAnalysis;
};

export async function analyzeWithOpenAI(input: AiAnalysisInput): Promise<DrawingAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return input.fallback;

  const body = buildResponsesBody(input);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI analysis failed: ${response.status} ${text.slice(0, 500)}`);
  }

  const payload = await response.json();
  const text = extractResponseText(payload);
  const parsed = JSON.parse(text) as Partial<DrawingAnalysis>;
  const entities = sanitizeEntities(parsed.entities ?? []);
  const features = sanitizeFeatures(parsed.features ?? []);

  return {
    source: "ai-assisted",
    fileName: input.fileName,
    units: sanitizeUnit(parsed.units),
    scale: typeof parsed.scale === "number" && parsed.scale > 0 ? parsed.scale : 1,
    entities,
    features,
    uncertainties: parsed.uncertainties ?? input.fallback.uncertainties,
    warnings: [...(input.fallback.warnings ?? []), ...(parsed.warnings ?? [])],
    bounds: calculateBounds(entities)
  };
}

function buildResponsesBody(input: AiAnalysisInput) {
  const fileData = `data:${input.mimeType};base64,${input.buffer.toString("base64")}`;
  const content =
    input.mimeType === "application/pdf"
      ? [
          {
            type: "input_file",
            filename: input.fileName,
            file_data: fileData
          }
        ]
      : [
          {
            type: "input_image",
            image_url: fileData
          }
        ];

  return {
    model: process.env.OPENAI_CNC_MODEL ?? "gpt-5.5",
    input: [
      {
        role: "system",
        content:
          "Du analysierst technische 2.5D-Fräszeichnungen. Gib nur validierbare JSON-Daten zurück. Erfinde keine sicheren Maße, wenn sie nicht lesbar sind; nutze uncertainties."
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Extrahiere Einheiten, Maßstab, 2D-Geometrie, Bohrungen, Konturen, Taschen und Unsicherheiten. Koordinaten sollen in Millimetern im Zeichnungskoordinatensystem liegen. Keine G-Code-Erzeugung."
          },
          ...content
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "cnc_drawing_analysis",
        strict: false,
        schema: drawingAnalysisSchema
      }
    }
  };
}

const drawingAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    units: { enum: ["mm", "inch", "unknown"] },
    scale: { type: "number" },
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          type: { enum: ["line", "circle", "arc", "polyline"] },
          layer: { type: "string" }
        },
        required: ["id", "type"]
      }
    },
    features: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          type: { enum: ["profile", "pocket", "drill", "engrave"] },
          label: { type: "string" },
          confidence: { type: "number" }
        },
        required: ["id", "type", "label", "confidence"]
      }
    },
    uncertainties: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          severity: { enum: ["info", "warning", "critical"] },
          message: { type: "string" },
          suggestedAction: { type: "string" }
        },
        required: ["id", "severity", "message"]
      }
    },
    warnings: { type: "array", items: { type: "string" } }
  },
  required: ["units", "scale", "entities", "features", "uncertainties", "warnings"]
};

function extractResponseText(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) throw new Error("OpenAI response is not an object.");
  const maybeText = (payload as { output_text?: unknown }).output_text;
  if (typeof maybeText === "string") return maybeText;
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) throw new Error("OpenAI response did not contain output_text.");
  const texts = output.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (typeof part !== "object" || part === null) return [];
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    });
  });
  if (texts.length === 0) throw new Error("OpenAI response did not contain text content.");
  return texts.join("\n");
}

function sanitizeUnit(unit: unknown): Unit {
  return unit === "mm" || unit === "inch" || unit === "unknown" ? unit : "unknown";
}

function sanitizeEntities(entities: unknown[]): GeometryEntity[] {
  return entities.filter((entity): entity is GeometryEntity => {
    if (typeof entity !== "object" || entity === null) return false;
    const candidate = entity as { id?: unknown; type?: unknown };
    return typeof candidate.id === "string" && ["line", "circle", "arc", "polyline"].includes(String(candidate.type));
  });
}

function sanitizeFeatures(features: unknown[]): MachiningFeature[] {
  return features.filter((feature): feature is MachiningFeature => {
    if (typeof feature !== "object" || feature === null) return false;
    const candidate = feature as { id?: unknown; type?: unknown; label?: unknown; confidence?: unknown };
    return (
      typeof candidate.id === "string" &&
      typeof candidate.label === "string" &&
      typeof candidate.confidence === "number" &&
      ["profile", "pocket", "drill", "engrave"].includes(String(candidate.type))
    );
  });
}
