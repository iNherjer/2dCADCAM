import type { Bounds2, GeometryEntity, Point2 } from "./schema";

export function calculateBounds(entities: GeometryEntity[]): Bounds2 | null {
  const points = entities.flatMap(entityPoints);
  if (points.length === 0) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function entityPoints(entity: GeometryEntity): Point2[] {
  switch (entity.type) {
    case "line":
      return [entity.start, entity.end];
    case "circle":
      return [
        { x: entity.center.x - entity.radius, y: entity.center.y - entity.radius },
        { x: entity.center.x + entity.radius, y: entity.center.y + entity.radius }
      ];
    case "arc":
      return [
        { x: entity.center.x - entity.radius, y: entity.center.y - entity.radius },
        { x: entity.center.x + entity.radius, y: entity.center.y + entity.radius }
      ];
    case "polyline":
      return entity.points;
  }
}

export function discretizeEntity(entity: GeometryEntity, segmentCount = 64): Point2[] {
  switch (entity.type) {
    case "line":
      return [entity.start, entity.end];
    case "circle":
      return Array.from({ length: segmentCount + 1 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / segmentCount;
        return {
          x: entity.center.x + Math.cos(angle) * entity.radius,
          y: entity.center.y + Math.sin(angle) * entity.radius
        };
      });
    case "arc": {
      const start = degToRad(entity.startAngleDeg);
      const end = degToRad(entity.endAngleDeg < entity.startAngleDeg ? entity.endAngleDeg + 360 : entity.endAngleDeg);
      const steps = Math.max(6, Math.ceil(((end - start) / (Math.PI * 2)) * segmentCount));
      return Array.from({ length: steps + 1 }, (_, index) => {
        const angle = start + ((end - start) * index) / steps;
        return {
          x: entity.center.x + Math.cos(angle) * entity.radius,
          y: entity.center.y + Math.sin(angle) * entity.radius
        };
      });
    }
    case "polyline":
      return entity.closed ? [...entity.points, entity.points[0]].filter(Boolean) : entity.points;
  }
}

export function isClosedEntity(entity: GeometryEntity, epsilon = 0.01): boolean {
  if (entity.type === "circle") return true;
  if (entity.type === "polyline") return entity.closed || pointsAlmostEqual(entity.points[0], entity.points.at(-1), epsilon);
  return false;
}

export function pointsAlmostEqual(a?: Point2, b?: Point2, epsilon = 0.01): boolean {
  if (!a || !b) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) <= epsilon;
}

function degToRad(deg: number): number {
  return (deg / 180) * Math.PI;
}
