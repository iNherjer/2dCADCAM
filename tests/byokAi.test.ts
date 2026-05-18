import { describe, expect, it } from "vitest";
import { buildToolpaths, generateGCode } from "../shared/cam";
import { defaultCamParameters } from "../shared/schema";
import { normalizeAiAnalysis } from "../src/lib/byokAi";

describe("BYOK AI normalization", () => {
  it("derives usable flange geometry from dimension readouts when feature refs are missing", () => {
    const analysis = normalizeAiAnalysis(
      {
        units: "mm",
        scale: 1,
        dimensionReadout: [
          "Gesamtgröße 120x120",
          "Flanschdicke 20",
          "Eckenradius R20",
          "4x Bohrung Ø20",
          "Aufsatz Ø60",
          "Zentraler Durchmesser Ø35",
          "Zentrale Bohrung Ø20",
          "Gesamthöhe 75"
        ],
        entities: [],
        features: [
          { id: "bad-profile", type: "profile", label: "profile", geometryEntityIds: [], depthMm: 1, confidence: 0.5 },
          { id: "bad-pocket", type: "pocket", label: "pocket", geometryEntityIds: [], depthMm: 1, confidence: 0.5 }
        ],
        uncertainties: [],
        warnings: []
      },
      "flange.png",
      "gemini"
    );

    expect(analysis.entities.map((entity) => entity.id)).toEqual(
      expect.arrayContaining([
        "derived-outer",
        "derived-hole-1",
        "derived-hole-2",
        "derived-hole-3",
        "derived-hole-4",
        "derived-boss",
        "derived-center-pocket",
        "derived-center-drill"
      ])
    );
    expect(analysis.features.map((feature) => feature.id)).toEqual(
      expect.arrayContaining(["derived-outer-profile", "derived-hole-1-drill", "derived-boss-profile", "derived-center-pocket", "derived-center-drill"])
    );
    expect(analysis.features.every((feature) => feature.geometryEntityIds.length > 0)).toBe(true);
    expect(analysis.features.find((feature) => feature.id === "derived-center-pocket")?.depthMm).toBe(55);
    expect(analysis.features.find((feature) => feature.id === "derived-center-drill")?.depthMm).toBe(75);

    const toolpaths = buildToolpaths(analysis, { ...defaultCamParameters, cutDepthMm: 1, stepDownMm: 1 });
    const gcode = generateGCode(analysis, defaultCamParameters, toolpaths);
    expect(toolpaths.length).toBeGreaterThanOrEqual(7);
    expect(gcode.text).toContain("G1 X");
    expect(gcode.text).not.toContain("Keine Werkzeugpfadpunkte erzeugt");
  });
});
