import { useMemo } from "react";
import { discretizeEntity } from "../lib/geometry";
import type { AnalysisResult, Bounds2, Point2 } from "../../shared/schema";

type Props = {
  result: AnalysisResult | null;
};

export function DrawingPreview({ result }: Props) {
  const geometry = result?.analysis.entities ?? [];
  const bounds = result?.analysis.bounds;
  const paths = useMemo(() => geometry.map((entity) => discretizeEntity(entity)), [geometry]);

  return (
    <section className="canvas-panel">
      <div className="section-title compact">
        <h2>2D Zeichnung</h2>
        <span>{geometry.length} Elemente</span>
      </div>
      <div className="drawing-surface">
        {bounds && paths.length ? (
          <svg viewBox={viewBox(bounds)} role="img" aria-label="2D Zeichnungsvorschau">
            <g transform={`scale(1 -1) translate(0 ${-(bounds.minY + bounds.maxY)})`}>
              {paths.map((points, index) => (
                <polyline key={index} points={pointsToSvg(points)} className="entity-line" />
              ))}
            </g>
          </svg>
        ) : (
          <div className="empty-state">DXF importieren oder KI-Analyse für PDF/Bild starten</div>
        )}
      </div>
    </section>
  );
}

function viewBox(bounds: Bounds2): string {
  const padding = Math.max(bounds.width, bounds.height, 10) * 0.08;
  return `${bounds.minX - padding} ${bounds.minY - padding} ${bounds.width + padding * 2 || 10} ${bounds.height + padding * 2 || 10}`;
}

function pointsToSvg(points: Point2[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}
