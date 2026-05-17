import type { AnalysisResult } from "../../shared/schema";

type Props = {
  result: AnalysisResult | null;
};

export function GCodePanel({ result }: Props) {
  return (
    <pre className="gcode-panel">
      <code>{result?.gcode.text ?? "(Noch kein Programm erzeugt.)"}</code>
    </pre>
  );
}
