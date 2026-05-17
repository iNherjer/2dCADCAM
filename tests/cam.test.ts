import { describe, expect, it } from "vitest";
import { buildToolpaths, generateGCode } from "../server/cam";
import { parseDxf } from "../server/dxf";
import { defaultCamParameters } from "../shared/schema";

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
    expect(toolpaths[0].passes).toHaveLength(2);
    expect(gcode.text).toContain("G21");
    expect(gcode.text).toContain("(Operation: Geschlossene Kontur)");
    expect(gcode.text).toContain("M30");
  });
});
