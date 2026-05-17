export type Unit = "mm" | "inch" | "unknown";

export type GeometryEntity =
  | {
      id: string;
      type: "line";
      layer?: string;
      start: Point2;
      end: Point2;
    }
  | {
      id: string;
      type: "circle";
      layer?: string;
      center: Point2;
      radius: number;
    }
  | {
      id: string;
      type: "arc";
      layer?: string;
      center: Point2;
      radius: number;
      startAngleDeg: number;
      endAngleDeg: number;
    }
  | {
      id: string;
      type: "polyline";
      layer?: string;
      points: Point2[];
      closed: boolean;
    };

export type Point2 = {
  x: number;
  y: number;
};

export type DrawingAnalysis = {
  source: "local-dxf" | "local-image" | "local-pdf" | "ai-assisted";
  fileName: string;
  units: Unit;
  scale: number;
  entities: GeometryEntity[];
  features: MachiningFeature[];
  uncertainties: AnalysisUncertainty[];
  warnings: string[];
  bounds: Bounds2 | null;
};

export type Bounds2 = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

export type AnalysisUncertainty = {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
  suggestedAction?: string;
};

export type MachiningFeature =
  | {
      id: string;
      type: "profile" | "pocket";
      label: string;
      geometryEntityIds: string[];
      depthMm: number;
      side: "inside" | "outside" | "center";
      confidence: number;
    }
  | {
      id: string;
      type: "drill";
      label: string;
      geometryEntityIds: string[];
      center: Point2;
      diameterMm: number;
      depthMm: number;
      confidence: number;
    }
  | {
      id: string;
      type: "engrave";
      label: string;
      geometryEntityIds: string[];
      depthMm: number;
      confidence: number;
    };

export type CamParameters = {
  toolDiameterMm: number;
  stockThicknessMm: number;
  cutDepthMm: number;
  stepDownMm: number;
  feedRateMmMin: number;
  plungeRateMmMin: number;
  spindleRpm: number;
  safeZMm: number;
  workZMm: number;
  tabsEnabled: boolean;
  postProcessor: "grbl" | "linuxcnc";
};

export type ToolpathOperation = {
  id: string;
  type: "profile" | "pocket" | "drill" | "engrave";
  label: string;
  depthMm: number;
  passes: ToolpathPass[];
  warnings: string[];
};

export type ToolpathPass = {
  zMm: number;
  moves: ToolpathMove[];
};

export type ToolpathMove =
  | { kind: "rapid"; to: Point3 }
  | { kind: "linear"; to: Point3; feedMmMin?: number }
  | { kind: "arc"; to: Point3; centerOffset: Point2; clockwise: boolean; feedMmMin?: number };

export type Point3 = Point2 & {
  z: number;
};

export type GCodeProgram = {
  header: string[];
  setup: string[];
  operations: string[];
  footer: string[];
  warnings: string[];
  text: string;
};

export type AnalysisResult = {
  analysis: DrawingAnalysis;
  camParameters: CamParameters;
  toolpaths: ToolpathOperation[];
  gcode: GCodeProgram;
  aiUsed: boolean;
};

export type AiProvider = "none" | "openai" | "gemini";

export type ClientAiSettings = {
  provider: AiProvider;
  apiKey: string;
  model: string;
  rememberForSession: boolean;
};

export const defaultCamParameters: CamParameters = {
  toolDiameterMm: 3,
  stockThicknessMm: 6,
  cutDepthMm: 3,
  stepDownMm: 1,
  feedRateMmMin: 450,
  plungeRateMmMin: 120,
  spindleRpm: 12000,
  safeZMm: 5,
  workZMm: 0,
  tabsEnabled: false,
  postProcessor: "grbl"
};
