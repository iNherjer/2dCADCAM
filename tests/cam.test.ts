import { describe, expect, it } from "vitest";
import { buildToolpaths, generateGCode } from "../server/cam";
import { parseDxf } from "../server/dxf";
import { defaultCamParameters, type DrawingAnalysis } from "../shared/schema";

const square = `0
SECTION
2
HEADER
9
$INSUNITS
70
4
0
ENDSEC
0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
OUTER
70
1
10
0
20
0
10
10
20
0
10
10
20
10
10
0
20
10
0
ENDSEC
0
EOF`;

describe("CAM generation", () => {
  it("generates multi-pass g-code for a closed contour", () => {
    const analysis = parseDxf(square, "square.dxf");
    const params = { ...defaultCamParameters, cutDepthMm: 2, stepDownMm: 1 };
    const toolpaths = buildToolpaths(analysis, params);
    const gcode = generateGCode(analysis, params, toolpaths);
    expect(toolpaths[0].passes).toHaveLength(3);
    expect(gcode.text).toContain("G21");
    expect(gcode.text).toContain("(Operation: Geschlossene Kontur)");
    expect(gcode.text).toContain("M30");
  });

  it("uses helical arc drilling when hole diameter is larger than tool diameter", () => {
    const analysis: DrawingAnalysis = {
      source: "ai-assisted",
      fileName: "helix-test.png",
      units: "mm",
      scale: 1,
      entities: [{ id: "hole", type: "circle", center: { x: 20, y: 20 }, radius: 6 }],
      features: [
        {
          id: "hole-drill",
          type: "drill",
          label: "Bohrung Ø12",
          geometryEntityIds: ["hole"],
          center: { x: 20, y: 20 },
          diameterMm: 12,
          depthMm: 4,
          confidence: 1
        }
      ],
      uncertainties: [],
      warnings: [],
      bounds: { minX: 14, minY: 14, maxX: 26, maxY: 26, width: 12, height: 12 }
    };

    const params = { ...defaultCamParameters, toolDiameterMm: 6, cutDepthMm: 4, stepDownMm: 2 };
    const toolpaths = buildToolpaths(analysis, params);
    const gcode = generateGCode(analysis, params, toolpaths);

    expect(gcode.text).toContain("(Operation: Bohrung Ø12)");
    expect(gcode.text).toContain("G2 X17 Y20 Z-1");
    expect(gcode.text).toContain("G2 X23 Y20 Z-2");
    expect(gcode.text).toContain("I-3 J0");
    expect(gcode.text).toContain("I3 J0");
  });
});
