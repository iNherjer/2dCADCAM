import { describe, expect, it } from "vitest";
import { parseDxf } from "../server/dxf";

const sample = `0
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
20
20
0
10
20
20
10
10
0
20
10
0
CIRCLE
8
DRILL
10
5
20
5
40
2
0
ENDSEC
0
EOF`;

describe("parseDxf", () => {
  it("extracts supported geometry and infers basic features", () => {
    const analysis = parseDxf(sample, "sample.dxf");
    expect(analysis.units).toBe("mm");
    expect(analysis.entities).toHaveLength(2);
    expect(analysis.features.map((feature) => feature.type)).toEqual(["profile", "drill"]);
    expect(analysis.bounds?.width).toBe(20);
    expect(analysis.bounds?.height).toBe(10);
  });
});
