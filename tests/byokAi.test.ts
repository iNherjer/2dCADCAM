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
        "derived-outer-line-bottom",
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

  it("classifies terse diameter readouts from Gemini into holes, boss, and pocket", () => {
    const analysis = normalizeAiAnalysis(
      {
        units: "mm",
        scale: 1,
        dimensionReadout: ["120x120", "R 20 (Ecken)", "4 x Ø 20", "Ø 35", "Ø 60", "Höhe Grundplatte 20", "Gesamthöhe 75"],
        entities: [],
        features: [],
        uncertainties: [],
        warnings: []
      },
      "flange.png",
      "gemini"
    );

    expect(analysis.entities.map((entity) => entity.id)).toEqual(
      expect.arrayContaining(["derived-hole-1", "derived-hole-2", "derived-hole-3", "derived-hole-4", "derived-boss", "derived-center-pocket"])
    );
    expect(analysis.features.map((feature) => feature.id)).toEqual(
      expect.arrayContaining(["derived-hole-1-drill", "derived-hole-2-drill", "derived-hole-3-drill", "derived-hole-4-drill", "derived-boss-profile", "derived-center-pocket"])
    );

    const toolpaths = buildToolpaths(analysis, { ...defaultCamParameters, cutDepthMm: 1, stepDownMm: 5 });
    const gcode = generateGCode(analysis, defaultCamParameters, toolpaths);
    expect(gcode.text).toContain("(Operation: Bohrung 1 Ø20)");
    expect(gcode.text).toContain("(Operation: Aufsatz Ø60)");
    expect(gcode.text).toContain("(Operation: Zentral Tasche Ø35)");
    expect(gcode.text).toContain("G2 X");
    expect(gcode.text).toContain("G3 X");
  });
});
