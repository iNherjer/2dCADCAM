import { calculateBounds } from "../../shared/geometry";
import type { ClientAiSettings, DrawingAnalysis, GeometryEntity, MachiningFeature, Unit } from "../../shared/schema";

const aiPrompt = `
Analysiere diese technische Zeichnung fuer 2.5D-Fraesen in zwei Schritten:
1. Lies zuerst alle sichtbaren Masse, Ansichten, Durchmesser, Radien und Hoehen.
2. Leite daraus eine top-view XY-Geometrie in Millimetern ab.

Wichtige Regeln:
- Verwende mm, wenn die Zeichnung keine andere Einheit zeigt.
- Wenn eine Draufsicht bemaßt ist, setze den Ursprung unten links an die Aussenkontur der Draufsicht.
- Erzeuge fuer Bohrungen und runde Taschen immer circle-Entities und verknuepfe Features ueber geometryEntityIds.
- Erzeuge fuer eine rechteckige Aussenkontur mit Eckradius eine geschlossene polyline. Runde Ecken duerfen mit mehreren Punkten angenaehert werden.
- Interpretiere "base height", "flange height", "Grundplattenhoehe" oder "Flanschhoehe" als Dicke der Grundplatte.
- Wenn eine zentrale Ø35 Tasche/Senkung in der Draufsicht sichtbar ist und die Seitenansicht eine Ø20 Durchgangsbohrung durch einen Aufsatz zeigt, lasse Ø35 nicht weg. Falls keine Tiefe explizit steht, setze die Tiefe vorsichtig auf Aufsatzhoehe = Gesamthoehe minus Grundplattenhoehe und markiere diese Tiefe als abgeleitet.
- Wenn ein Feature nur aus der Seitenansicht erkennbar ist, notiere es als warning oder uncertainty.
- Gib keine G-Code-Daten aus.
- Gib ausschliesslich JSON zurueck.

JSON-Form:
{
  "units": "mm" | "inch" | "unknown",
  "scale": 1,
  "dimensionReadout": ["kurze Liste gelesener Masse"],
  "entities": [
    {"id":"outer","type":"polyline","points":[{"x":20,"y":0}],"closed":true},
    {"id":"hole-1","type":"circle","center":{"x":20,"y":20},"radius":10}
  ],
  "features": [
    {"id":"outer-profile","type":"profile","label":"Aussenkontur","geometryEntityIds":["outer"],"depthMm":20,"side":"outside","confidence":0.8},
    {"id":"hole-1-drill","type":"drill","label":"Bohrung Ø20","geometryEntityIds":["hole-1"],"center":{"x":20,"y":20},"diameterMm":20,"depthMm":20,"confidence":0.8}
  ],
  "uncertainties": [],
  "warnings": []
}
`.trim();

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
  const model = settings.model || "gemini-2.5-pro";
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
        responseSchema: geminiResponseSchema,
        temperature: 0.1
      }
    })
  });

  if (!response.ok) throw new Error(await readableApiError(response, "Gemini"));
  return JSON.parse(stripJsonFence(extractGeminiText(await response.json())));
}

export function normalizeAiAnalysis(raw: unknown, fileName: string, provider: ClientAiSettings["provider"]): DrawingAnalysis {
  const source = asRecord(raw);
  const repaired = sanitizeAndRepairGeometry(source);
  return {
    source: "ai-assisted",
    fileName,
    units: sanitizeUnit(source.units),
    scale: typeof source.scale === "number" && source.scale > 0 ? source.scale : 1,
    entities: repaired.entities,
    features: repaired.features,
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
      ...asArray(source.dimensionReadout).map((item) => `Gelesenes Mass: ${String(item)}`),
      ...asArray(source.warnings).map(String)
    ],
    bounds: calculateBounds(repaired.entities)
  };
}

function sanitizeAndRepairGeometry(source: Record<string, unknown>): { entities: GeometryEntity[]; features: MachiningFeature[] } {
  const entities = sanitizeEntities(asArray(source.entities));
  const features = sanitizeFeatures(asArray(source.features), entities);
  const dimensionText = [
    ...asArray(source.dimensionReadout).map(String),
    ...asArray(source.warnings).map(String),
    ...features.map((feature) => feature.label)
  ].join(" | ");
  addDimensionDerivedGeometry(dimensionText, entities, features);
  return { entities, features: features.filter((feature) => hasUsableGeometry(feature, entities)) };
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

function sanitizeFeatures(values: unknown[], entities: GeometryEntity[]): MachiningFeature[] {
  const features: MachiningFeature[] = [];
  values.forEach((value, index) => {
    const feature = asRecord(value);
    const id = String(feature.id ?? `ai-feature-${index + 1}`);
    const label = String(feature.label ?? feature.type ?? "Feature");
    const geometryEntityIds = repairGeometryRefs(feature, id, entities);
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

function repairGeometryRefs(feature: Record<string, unknown>, featureId: string, entities: GeometryEntity[]): string[] {
  const existing = asArray(feature.geometryEntityIds).map(String).filter((id) => entities.some((entity) => entity.id === id));
  if (existing.length) return existing;

  const center = point(feature.center);
  const diameter = number(feature.diameterMm);
  const radius = number(feature.radiusMm) || diameter / 2;
  if (center && radius > 0) {
    const id = `ai-geo-${featureId}`;
    entities.push({ id, type: "circle", center, radius, layer: String(feature.type ?? "ai") });
    return [id];
  }

  const width = number(feature.widthMm);
  const height = number(feature.heightMm);
  const cornerRadius = number(feature.cornerRadiusMm);
  if (width > 0 && height > 0) {
    const id = `ai-geo-${featureId}`;
    entities.push({
      id,
      type: "polyline",
      points: roundedRectPoints(width, height, Math.max(0, cornerRadius)),
      closed: true,
      layer: String(feature.type ?? "ai")
    });
    return [id];
  }

  return asArray(feature.geometryEntityIds).map(String);
}

function addDimensionDerivedGeometry(text: string, entities: GeometryEntity[], features: MachiningFeature[]): void {
  const normalized = normalizeDimensionText(text);
  const hints = readDimensionHints(normalized);
  const plate = readPlateSize(normalized);
  const cornerRadius = readRadiusNear(normalized, ["eckenradius", "corner", "aussen"]);
  const totalHeight = readNumberNear(normalized, ["gesamthohe", "gesamt hohe", "total height", "overall height"]);
  const thickness =
    readNumberNear(normalized, [
      "flanschdicke",
      "flanschhohe",
      "flange thickness",
      "flange height",
      "grundplattendicke",
      "grundplattenhohe",
      "grundplatte",
      "base thickness",
      "base height",
      "platte",
      "dicke"
    ]) ?? 1;
  const bossHeight = totalHeight && thickness ? Math.max(0.1, totalHeight - thickness) : thickness;
  const center = plate ? { x: plate.width / 2, y: plate.height / 2 } : undefined;

  if (plate && !entities.some((entity) => entity.id === "derived-outer")) {
    const outerEntityIds = addRoundedRectEntities("derived-outer", plate.width, plate.height, cornerRadius ?? 0, entities);
    removeSimilarFeatures(features, "outer");
    features.push({
      id: "derived-outer-profile",
      type: "profile",
      label: `Aussenkontur ${plate.width}x${plate.height}${cornerRadius ? ` R${cornerRadius}` : ""}`,
      geometryEntityIds: outerEntityIds,
      depthMm: thickness,
      side: "outside",
      confidence: 0.82
    });
  }

  const holeDiameter = readPatternDiameter(normalized, /(?:4\s*x|4x|vier)\s*(?:bohrung|bohrungen|holes?)/) ?? hints.mountingHoleDiameter;
  if (plate && holeDiameter && !entities.some((entity) => entity.id === "derived-hole-1")) {
    const inset = inferMountingHoleInset(plate, holeDiameter, cornerRadius);
    const centers = [
      { x: inset, y: inset },
      { x: plate.width - inset, y: inset },
      { x: plate.width - inset, y: plate.height - inset },
      { x: inset, y: plate.height - inset }
    ];
    removeSimilarFeatures(features, "mounting-holes");
    centers.forEach((holeCenter, index) => {
      const id = `derived-hole-${index + 1}`;
      entities.push({ id, type: "circle", layer: "derived-drill", center: holeCenter, radius: holeDiameter / 2 });
      features.push({
        id: `${id}-drill`,
        type: "drill",
        label: `Bohrung ${index + 1} Ø${holeDiameter}`,
        geometryEntityIds: [id],
        center: holeCenter,
        diameterMm: holeDiameter,
        depthMm: thickness,
        confidence: 0.78
      });
    });
  }

  const bossDiameter = readDiameterNear(normalized, ["aufsatz", "absatz", "boss", "nabe"]) ?? hints.bossDiameter;
  if (center && bossDiameter && !entities.some((entity) => entity.id === "derived-boss")) {
    entities.push({ id: "derived-boss", type: "circle", layer: "derived-boss", center, radius: bossDiameter / 2 });
    removeSimilarFeatures(features, "boss-profile");
    const outerIds = entities.filter((entity) => entity.id.startsWith("derived-outer")).map((entity) => entity.id);
    if (outerIds.length) {
      features.push({
        id: "derived-top-clearance",
        type: "pocket",
        label: `Freiraeumen um Aufsatz Ø${bossDiameter}`,
        geometryEntityIds: [...outerIds, "derived-boss"],
        depthMm: bossHeight,
        side: "inside",
        confidence: 0.68
      });
    }
  }

  if (center && bossDiameter && entities.some((entity) => entity.id === "derived-boss") && !features.some((feature) => feature.id === "derived-top-clearance")) {
    removeSimilarFeatures(features, "boss-profile");
    const outerIds = entities.filter((entity) => entity.id.startsWith("derived-outer")).map((entity) => entity.id);
    if (outerIds.length) {
      features.push({
        id: "derived-top-clearance",
        type: "pocket",
        label: `Freiraeumen um Aufsatz Ø${bossDiameter}`,
        geometryEntityIds: [...outerIds, "derived-boss"],
        depthMm: bossHeight,
        side: "inside",
        confidence: 0.68
      });
    }
  }

  const centralDiameters = readDiametersNear(normalized, [
    "zentralbohrung",
    "zentrale bohrung",
    "zentraler durchmesser",
    "zentral",
    "central",
    "center",
    "centre",
    "mitte",
    "through-hole",
    "through hole",
    "counterbore",
    "pocket"
  ]);
  const pocketDiameter = centralDiameters.filter((diameter) => diameter >= 25 && diameter !== bossDiameter).sort((a, b) => b - a)[0];
  const throughDiameter = centralDiameters.filter((diameter) => !pocketDiameter || diameter < pocketDiameter).sort((a, b) => a - b)[0];
  const derivedPocketDiameter = pocketDiameter ?? hints.centralPocketDiameter;
  const derivedThroughDiameter = throughDiameter ?? hints.centralDrillDiameter;
  if (center && derivedPocketDiameter && !entities.some((entity) => entity.id === "derived-center-pocket")) {
    entities.push({ id: "derived-center-pocket", type: "circle", layer: "derived-pocket", center, radius: derivedPocketDiameter / 2 });
    removeSimilarFeatures(features, "center-pocket");
    features.push({
      id: "derived-center-pocket",
      type: "pocket",
      label: `Zentral Tasche Ø${derivedPocketDiameter}`,
      geometryEntityIds: ["derived-center-pocket"],
      depthMm: bossHeight,
      side: "inside",
      confidence: 0.74
    });
  }
  if (center && derivedThroughDiameter && !entities.some((entity) => entity.id === "derived-center-drill")) {
    entities.push({ id: "derived-center-drill", type: "circle", layer: "derived-drill", center, radius: derivedThroughDiameter / 2 });
    removeSimilarFeatures(features, "center-drill");
    features.push({
      id: "derived-center-drill",
      type: "drill",
      label: `Zentral Bohrung Ø${derivedThroughDiameter}`,
      geometryEntityIds: ["derived-center-drill"],
      center,
      diameterMm: derivedThroughDiameter,
      depthMm: totalHeight ?? thickness,
      confidence: 0.74
    });
  }
}

function readDimensionHints(text: string): {
  mountingHoleDiameter: number | null;
  bossDiameter: number | null;
  centralPocketDiameter: number | null;
  centralDrillDiameter: number | null;
} {
  const lines = text
    .split("|")
    .map((line) => line.replace(/gelesenes mass:\s*/g, "").trim())
    .filter(Boolean);

  let mountingHoleDiameter: number | null = null;
  let bossDiameter: number | null = null;
  let centralPocketDiameter: number | null = null;
  let centralDrillDiameter: number | null = null;
  const unlabeled: number[] = [];

  for (const line of lines) {
    const diameters = readDiameters(line);
    if (!diameters.length) continue;

    if (/\b(?:4\s*x|4x|vier)\b/.test(line)) {
      mountingHoleDiameter = diameters[0];
      continue;
    }

    if (/\b(?:aufsatz|absatz|boss|nabe)\b/.test(line)) {
      bossDiameter = Math.max(...diameters);
      continue;
    }

    if (/\b(?:zentraler durchmesser|senkung|tasche|pocket|counterbore)\b/.test(line)) {
      centralPocketDiameter = Math.max(...diameters);
      continue;
    }

    if (/\b(?:zentrale bohrung|zentralbohrung|durchgang|through-hole|through hole|central hole|center hole)\b/.test(line) && !/\b(?:widerspruch|widerspruchliche|annahme)\b/.test(line)) {
      centralDrillDiameter = Math.min(...diameters);
      continue;
    }

    if (/^d\s*\d+(?:\.\d+)?$/.test(line) || /^mass:\s*d\s*\d+(?:\.\d+)?$/.test(line)) {
      unlabeled.push(...diameters);
    }
  }

  const uniqueUnlabeled = Array.from(new Set(unlabeled)).sort((a, b) => b - a);
  if (!bossDiameter && uniqueUnlabeled.length) bossDiameter = uniqueUnlabeled[0];
  if (!centralPocketDiameter) {
    centralPocketDiameter = uniqueUnlabeled.find((diameter) => diameter !== bossDiameter && diameter !== mountingHoleDiameter && diameter >= 25) ?? null;
  }
  if (!centralDrillDiameter) {
    centralDrillDiameter = uniqueUnlabeled.find((diameter) => diameter !== bossDiameter && diameter !== centralPocketDiameter && diameter !== mountingHoleDiameter) ?? null;
  }

  return { mountingHoleDiameter, bossDiameter, centralPocketDiameter, centralDrillDiameter };
}

function removeSimilarFeatures(features: MachiningFeature[], category: "outer" | "mounting-holes" | "boss-profile" | "center-pocket" | "center-drill"): void {
  for (let index = features.length - 1; index >= 0; index -= 1) {
    const feature = features[index];
    if (feature.id.startsWith("derived-")) continue;
    const text = `${feature.id} ${feature.label}`.toLowerCase();
    const matches =
      (category === "outer" && /\b(?:outer|aussen|außen|kontur|profile)\b/.test(text) && feature.type === "profile") ||
      (category === "mounting-holes" && feature.type === "drill" && /\b(?:corner|eck|4x|bohrung|hole)\b/.test(text)) ||
      (category === "boss-profile" && /\b(?:boss|aufsatz|absatz|nabe)\b/.test(text)) ||
      (category === "center-pocket" && feature.type === "pocket" && /\b(?:central|center|zentral|counterbore|tasche|pocket|senkung)\b/.test(text)) ||
      (category === "center-drill" && feature.type === "drill" && /\b(?:central|center|zentral|through|durchgang)\b/.test(text));
    if (matches) features.splice(index, 1);
  }
}

function hasUsableGeometry(feature: MachiningFeature, entities: GeometryEntity[]): boolean {
  return feature.geometryEntityIds.some((id) => entities.some((entity) => entity.id === id));
}

function normalizeDimensionText(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ø", "d")
    .replaceAll("⌀", "d")
    .replaceAll("×", "x")
    .replaceAll(",", ".")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function readPlateSize(text: string): { width: number; height: number } | null {
  const match = text.match(/(?:gesamt(?:große|grosse|größe)?|aussen|outer|platte|flansch)?[^0-9]{0,20}(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

function readPatternDiameter(text: string, labelPattern: RegExp): number | null {
  const match = text.match(new RegExp(`${labelPattern.source}[^|]{0,40}d\\s*(\\d+(?:\\.\\d+)?)`));
  if (match) return Number(match[1]);
  const reversed = text.match(new RegExp(`d\\s*(\\d+(?:\\.\\d+)?)[^|]{0,40}${labelPattern.source}`));
  return reversed ? Number(reversed[1]) : null;
}

function readDiameterNear(text: string, labels: string[]): number | null {
  return readDiametersNear(text, labels)[0] ?? null;
}

function readDiametersNear(text: string, labels: string[]): number[] {
  const diameters: number[] = [];
  for (const label of labels) {
    const afterMatches = text.matchAll(new RegExp(`${label}[^|]{0,40}d\\s*(\\d+(?:\\.\\d+)?)`, "g"));
    for (const match of afterMatches) diameters.push(Number(match[1]));
    const beforeMatches = text.matchAll(new RegExp(`d\\s*(\\d+(?:\\.\\d+)?)[^|]{0,40}${label}`, "g"));
    for (const match of beforeMatches) diameters.push(Number(match[1]));
  }
  return Array.from(new Set(diameters.filter((diameter) => diameter > 0)));
}

function readDiameters(text: string): number[] {
  return Array.from(text.matchAll(/\bd\s*(\d+(?:\.\d+)?)/g))
    .map((match) => Number(match[1]))
    .filter((diameter) => diameter > 0);
}

function readRadiusNear(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const after = text.match(new RegExp(`${label}[^r0-9]{0,24}r\\s*(\\d+(?:\\.\\d+)?)`));
    if (after) return Number(after[1]);
    const before = text.match(new RegExp(`r\\s*(\\d+(?:\\.\\d+)?)[^|]{0,24}${label}`));
    if (before) return Number(before[1]);
  }
  const plain = text.match(/\br\s*(\d+(?:\.\d+)?)/);
  return plain ? Number(plain[1]) : null;
}

function readNumberNear(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}[^0-9]{0,20}(\\d+(?:\\.\\d+)?)`));
    if (match) return Number(match[1]);
  }
  return null;
}

function inferMountingHoleInset(plate: { width: number; height: number }, holeDiameter: number, cornerRadius: number | null): number {
  if (cornerRadius && cornerRadius >= holeDiameter / 2) return cornerRadius;
  return Math.max(holeDiameter, Math.min(plate.width, plate.height) / 6);
}

function roundedRectPoints(width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  if (r <= 0) {
    return [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height }
    ];
  }
  const points = [];
  const corners = [
    { cx: width - r, cy: r, start: -90, end: 0 },
    { cx: width - r, cy: height - r, start: 0, end: 90 },
    { cx: r, cy: height - r, start: 90, end: 180 },
    { cx: r, cy: r, start: 180, end: 270 }
  ];
  for (const corner of corners) {
    for (let step = 0; step <= 5; step += 1) {
      const angle = ((corner.start + ((corner.end - corner.start) * step) / 5) * Math.PI) / 180;
      points.push({ x: corner.cx + Math.cos(angle) * r, y: corner.cy + Math.sin(angle) * r });
    }
  }
  return points;
}

function addRoundedRectEntities(idPrefix: string, width: number, height: number, radius: number, entities: GeometryEntity[]): string[] {
  const r = Math.min(radius, width / 2, height / 2);
  if (r <= 0) {
    entities.push({
      id: idPrefix,
      type: "polyline",
      layer: "derived",
      points: roundedRectPoints(width, height, 0),
      closed: true
    });
    return [idPrefix];
  }

  const items: GeometryEntity[] = [
    { id: `${idPrefix}-line-bottom`, type: "line", layer: "derived", start: { x: r, y: 0 }, end: { x: width - r, y: 0 } },
    { id: `${idPrefix}-arc-bottom-right`, type: "arc", layer: "derived", center: { x: width - r, y: r }, radius: r, startAngleDeg: -90, endAngleDeg: 0 },
    { id: `${idPrefix}-line-right`, type: "line", layer: "derived", start: { x: width, y: r }, end: { x: width, y: height - r } },
    { id: `${idPrefix}-arc-top-right`, type: "arc", layer: "derived", center: { x: width - r, y: height - r }, radius: r, startAngleDeg: 0, endAngleDeg: 90 },
    { id: `${idPrefix}-line-top`, type: "line", layer: "derived", start: { x: width - r, y: height }, end: { x: r, y: height } },
    { id: `${idPrefix}-arc-top-left`, type: "arc", layer: "derived", center: { x: r, y: height - r }, radius: r, startAngleDeg: 90, endAngleDeg: 180 },
    { id: `${idPrefix}-line-left`, type: "line", layer: "derived", start: { x: 0, y: height - r }, end: { x: 0, y: r } },
    { id: `${idPrefix}-arc-bottom-left`, type: "arc", layer: "derived", center: { x: r, y: r }, radius: r, startAngleDeg: 180, endAngleDeg: 270 }
  ];
  entities.push(...items);
  return items.map((item) => item.id);
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
    dimensionReadout: { type: "array", items: { type: "string" } },
    entities: { type: "array", items: { type: "object", additionalProperties: true } },
    features: { type: "array", items: { type: "object", additionalProperties: true } },
    uncertainties: { type: "array", items: { type: "object", additionalProperties: true } },
    warnings: { type: "array", items: { type: "string" } }
  },
  required: ["units", "scale", "entities", "features", "uncertainties", "warnings"]
};

const pointSchema = {
  type: "OBJECT",
  properties: {
    x: { type: "NUMBER" },
    y: { type: "NUMBER" }
  }
};

const geminiResponseSchema = {
  type: "OBJECT",
  properties: {
    units: { type: "STRING" },
    scale: { type: "NUMBER" },
    dimensionReadout: { type: "ARRAY", items: { type: "STRING" } },
    entities: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          type: { type: "STRING" },
          layer: { type: "STRING" },
          start: pointSchema,
          end: pointSchema,
          center: pointSchema,
          radius: { type: "NUMBER" },
          startAngleDeg: { type: "NUMBER" },
          endAngleDeg: { type: "NUMBER" },
          points: { type: "ARRAY", items: pointSchema },
          closed: { type: "BOOLEAN" }
        }
      }
    },
    features: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          type: { type: "STRING" },
          label: { type: "STRING" },
          geometryEntityIds: { type: "ARRAY", items: { type: "STRING" } },
          center: pointSchema,
          diameterMm: { type: "NUMBER" },
          radiusMm: { type: "NUMBER" },
          widthMm: { type: "NUMBER" },
          heightMm: { type: "NUMBER" },
          cornerRadiusMm: { type: "NUMBER" },
          depthMm: { type: "NUMBER" },
          side: { type: "STRING" },
          confidence: { type: "NUMBER" }
        }
      }
    },
    uncertainties: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          severity: { type: "STRING" },
          message: { type: "STRING" },
          suggestedAction: { type: "STRING" }
        }
      }
    },
    warnings: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["units", "scale", "entities", "features", "uncertainties", "warnings"]
};
