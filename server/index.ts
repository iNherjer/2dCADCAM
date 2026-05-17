import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname } from "node:path";
import { parseDxf } from "./dxf";
import { analyzeWithOpenAI } from "./openai";
import { buildToolpaths, generateGCode } from "./cam";
import { calculateBounds } from "../shared/geometry";
import { defaultCamParameters, type AnalysisResult, type CamParameters, type DrawingAnalysis } from "../shared/schema";

const port = Number(process.env.PORT ?? 8787);

const server = createServer(async (req, res) => {
  try {
    setCors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, { ok: true, openAiConfigured: Boolean(process.env.OPENAI_API_KEY) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/analyze") {
      const multipart = await readMultipart(req);
      const file = multipart.files.file;
      if (!file) {
        sendJson(res, 400, { error: "Missing multipart file field named file." });
        return;
      }

      const camParameters = parseCamParameters(multipart.fields.camParameters);
      const useAi = multipart.fields.useAi !== "false";
      const analysis = await analyzeFile(file, useAi);
      const toolpaths = buildToolpaths(analysis, camParameters);
      const gcode = generateGCode(analysis, camParameters, toolpaths);
      const result: AnalysisResult = {
        analysis,
        camParameters,
        toolpaths,
        gcode,
        aiUsed: analysis.source === "ai-assisted"
      };
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Unexpected server error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`CNC analysis API listening on http://127.0.0.1:${port}`);
});

async function analyzeFile(file: MultipartFile, useAi: boolean): Promise<DrawingAnalysis> {
  const extension = extname(file.filename).toLowerCase();
  if (extension === ".dxf" || file.mimeType.includes("dxf")) {
    return parseDxf(file.buffer.toString("utf8"), file.filename);
  }

  const local = buildLocalUnstructuredAnalysis(file);
  if (!useAi) return local;

  try {
    return await analyzeWithOpenAI({
      fileName: file.filename,
      mimeType: file.mimeType || inferMimeType(file.filename),
      buffer: file.buffer,
      fallback: local
    });
  } catch (error) {
    return {
      ...local,
      warnings: [...local.warnings, error instanceof Error ? error.message : "KI-Analyse fehlgeschlagen."]
    };
  }
}

function buildLocalUnstructuredAnalysis(file: MultipartFile): DrawingAnalysis {
  const kind = inferMimeType(file.filename) === "application/pdf" ? "local-pdf" : "local-image";
  return {
    source: kind,
    fileName: file.filename,
    units: "unknown",
    scale: 1,
    entities: [],
    features: [],
    uncertainties: [
      {
        id: "ai-required",
        severity: "warning",
        message: "PDF/Bild benötigt KI-Analyse oder manuelle Nacharbeit für verwertbare Geometrie.",
        suggestedAction: "OPENAI_API_KEY setzen oder DXF verwenden."
      }
    ],
    warnings: ["Keine deterministische Geometrie aus PDF/Bild extrahiert."],
    bounds: calculateBounds([])
  };
}

function parseCamParameters(raw?: string): CamParameters {
  if (!raw) return defaultCamParameters;
  const parsed = JSON.parse(raw) as Partial<CamParameters>;
  return { ...defaultCamParameters, ...parsed };
}

type MultipartFile = {
  filename: string;
  mimeType: string;
  buffer: Buffer;
};

type MultipartRead = {
  fields: Record<string, string>;
  files: Record<string, MultipartFile>;
};

async function readMultipart(req: IncomingMessage): Promise<MultipartRead> {
  const contentType = req.headers["content-type"] ?? "";
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) throw new Error("Expected multipart/form-data request.");
  const boundary = boundaryMatch[1] ?? boundaryMatch[2];
  const body = await readBody(req);
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(body, boundaryBuffer).slice(1, -1);
  const fields: Record<string, string> = {};
  const files: Record<string, MultipartFile> = {};

  for (const part of parts) {
    const cleaned = trimCrlf(part);
    const separator = indexOfBuffer(cleaned, Buffer.from("\r\n\r\n"));
    if (separator === -1) continue;
    const headerText = cleaned.slice(0, separator).toString("utf8");
    const content = trimCrlf(cleaned.slice(separator + 4));
    const disposition = /content-disposition:\s*form-data;\s*([^\r\n]+)/i.exec(headerText)?.[1] ?? "";
    const name = /name="([^"]+)"/.exec(disposition)?.[1];
    const filename = /filename="([^"]*)"/.exec(disposition)?.[1];
    const mimeType = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() ?? "application/octet-stream";
    if (!name) continue;
    if (filename !== undefined) files[name] = { filename: filename || "upload", mimeType, buffer: content };
    else fields[name] = content.toString("utf8");
  }

  return { fields, files };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function splitBuffer(buffer: Buffer, separator: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  let index = indexOfBuffer(buffer, separator, start);
  while (index !== -1) {
    parts.push(buffer.slice(start, index));
    start = index + separator.length;
    index = indexOfBuffer(buffer, separator, start);
  }
  parts.push(buffer.slice(start));
  return parts;
}

function indexOfBuffer(buffer: Buffer, search: Buffer, from = 0): number {
  return buffer.indexOf(search, from);
}

function trimCrlf(buffer: Buffer): Buffer {
  let start = 0;
  let end = buffer.length;
  while (buffer[start] === 13 || buffer[start] === 10) start += 1;
  while (buffer[end - 1] === 13 || buffer[end - 1] === 10) end -= 1;
  return buffer.slice(start, end);
}

function inferMimeType(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".dxf") return "application/dxf";
  return "application/octet-stream";
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5173");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
