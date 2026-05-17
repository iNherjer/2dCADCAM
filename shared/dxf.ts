import { calculateBounds, isClosedEntity } from "./geometry";
import type { DrawingAnalysis, GeometryEntity, MachiningFeature, Unit } from "./schema";

type Pair = {
  code: string;
  value: string;
};

export function parseDxf(text: string, fileName: string): DrawingAnalysis {
  const pairs = toPairs(text);
  const units = parseUnits(pairs);
  const entities = parseEntities(pairs);
  const features = inferFeatures(entities);
  const warnings = [];
  if (entities.length === 0) warnings.push("Keine unterstützten DXF-Entitäten gefunden.");
  if (units === "unknown") warnings.push("DXF enthält keine eindeutig erkannte Einheit. Standardannahme im CAM ist Millimeter.");

  return {
    source: "local-dxf",
    fileName,
    units,
    scale: 1,
    entities,
    features,
    uncertainties:
      units === "unknown"
        ? [
            {
              id: "units-unknown",
              severity: "warning",
              message: "Einheit konnte nicht aus $INSUNITS abgeleitet werden.",
              suggestedAction: "Einheit vor dem Export prüfen."
            }
          ]
        : [],
    warnings,
    bounds: calculateBounds(entities)
  };
}

function toPairs(text: string): Pair[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim());
  const pairs: Pair[] = [];
  for (let index = 0; index < lines.length - 1; index += 2) {
    pairs.push({ code: lines[index], value: lines[index + 1] });
  }
  return pairs;
}

function parseUnits(pairs: Pair[]): Unit {
  const insunitsIndex = pairs.findIndex((pair) => pair.value === "$INSUNITS");
  if (insunitsIndex === -1) return "unknown";
  const unitPair = pairs.slice(insunitsIndex + 1, insunitsIndex + 5).find((pair) => pair.code === "70");
  switch (unitPair?.value) {
    case "1":
      return "inch";
    case "4":
      return "mm";
    default:
      return "unknown";
  }
}

function parseEntities(pairs: Pair[]): GeometryEntity[] {
  const sectionStart = pairs.findIndex((pair, index) => pair.code === "2" && pair.value === "ENTITIES" && pairs[index - 1]?.value === "SECTION");
  if (sectionStart === -1) return [];
  const sectionEnd = pairs.findIndex((pair, index) => index > sectionStart && pair.code === "0" && pair.value === "ENDSEC");
  const entityPairs = pairs.slice(sectionStart + 1, sectionEnd === -1 ? undefined : sectionEnd);
  const entities: GeometryEntity[] = [];

  let index = 0;
  while (index < entityPairs.length) {
    const pair = entityPairs[index];
    if (pair.code !== "0") {
      index += 1;
      continue;
    }

    const type = pair.value;
    const end = findNextEntityIndex(entityPairs, index + 1);
    const chunk = entityPairs.slice(index + 1, end);
    const entity = parseEntityChunk(type, chunk, entities.length + 1);
    if (entity) entities.push(entity);
    index = end;
  }

  return entities;
}

function findNextEntityIndex(pairs: Pair[], start: number): number {
  const next = pairs.findIndex((pair, index) => index >= start && pair.code === "0");
  return next === -1 ? pairs.length : next;
}

function parseEntityChunk(type: string, chunk: Pair[], idNumber: number): GeometryEntity | null {
  const id = `geo-${idNumber}`;
  const layer = valueFor(chunk, "8");

  if (type === "LINE") {
    return {
      id,
      type: "line",
      layer,
      start: { x: numberFor(chunk, "10"), y: numberFor(chunk, "20") },
      end: { x: numberFor(chunk, "11"), y: numberFor(chunk, "21") }
    };
  }

  if (type === "CIRCLE") {
    return {
      id,
      type: "circle",
      layer,
      center: { x: numberFor(chunk, "10"), y: numberFor(chunk, "20") },
      radius: numberFor(chunk, "40")
    };
  }

  if (type === "ARC") {
    return {
      id,
      type: "arc",
      layer,
      center: { x: numberFor(chunk, "10"), y: numberFor(chunk, "20") },
      radius: numberFor(chunk, "40"),
      startAngleDeg: numberFor(chunk, "50"),
      endAngleDeg: numberFor(chunk, "51")
    };
  }

  if (type === "LWPOLYLINE") {
    const points = parseLwPolylinePoints(chunk);
    return {
      id,
      type: "polyline",
      layer,
      points,
      closed: (numberFor(chunk, "70", 0) & 1) === 1
    };
  }

  return null;
}

function parseLwPolylinePoints(chunk: Pair[]) {
  const points = [];
  for (let index = 0; index < chunk.length; index += 1) {
    if (chunk[index].code === "10") {
      const yPair = chunk.slice(index + 1).find((pair) => pair.code === "20");
      points.push({ x: Number(chunk[index].value), y: Number(yPair?.value ?? 0) });
    }
  }
  return points;
}

function inferFeatures(entities: GeometryEntity[]): MachiningFeature[] {
  return entities.flatMap((entity, index): MachiningFeature[] => {
    if (entity.type === "circle") {
      const diameterMm = entity.radius * 2;
      if (diameterMm <= 12) {
        return [
          {
            id: `feature-${index + 1}`,
            type: "drill",
            label: `Bohrung Ø${formatNumber(diameterMm)} mm`,
            geometryEntityIds: [entity.id],
            center: entity.center,
            diameterMm,
            depthMm: 3,
            confidence: 0.92
          }
        ];
      }
    }

    if (isClosedEntity(entity)) {
      return [
        {
          id: `feature-${index + 1}`,
          type: "profile",
          label: entity.type === "circle" ? "Kreis-Kontur" : "Geschlossene Kontur",
          geometryEntityIds: [entity.id],
          depthMm: 3,
          side: "outside",
          confidence: 0.86
        }
      ];
    }

    return [
      {
        id: `feature-${index + 1}`,
        type: "engrave",
        label: "Offene Geometrie / Gravur",
        geometryEntityIds: [entity.id],
        depthMm: 0.2,
        confidence: 0.66
      }
    ];
  });
}

function valueFor(chunk: Pair[], code: string): string | undefined {
  return chunk.find((pair) => pair.code === code)?.value;
}

function numberFor(chunk: Pair[], code: string, fallback = 0): number {
  const value = valueFor(chunk, code);
  return value === undefined ? fallback : Number(value);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
