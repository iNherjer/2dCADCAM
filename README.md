# KI-gestütztes 2.5D-CNC-Zeichnungsanalyse-Tool

Lokales MVP für technische Zeichnungen, 2.5D-Fräsen, Werkzeugpfade und G-Code.

## Start

```bash
npm install
npm run dev:all
```

Frontend: `http://127.0.0.1:5173`  
API: `http://127.0.0.1:8787`

Für reinen Frontend-Betrieb ohne Backend:

```bash
npm run dev
```

Dann funktioniert die DXF-Analyse vollständig lokal im Browser. PDF/Bild kann entweder über ein eigenes Backend laufen oder im BYOK-Direktmodus mit einem OpenAI-/Gemini-Key, den der Nutzer in der Oberfläche eingibt.

## KI-Konfiguration

Die App läuft ohne API-Key mit deterministischer DXF-Analyse. Für PDF/Bild-Analyse:

```bash
export OPENAI_API_KEY="..."
export OPENAI_CNC_MODEL="gpt-5.5"
npm run dev:all
```

`OPENAI_CNC_MODEL` ist optional. Ohne Angabe nutzt der Server `gpt-5.5`.

## GitHub Pages

Die statische GitHub-Pages-Version wird über `.github/workflows/pages.yml` gebaut und deployed. Sie ist bewusst im DXF-only-Modus, solange `VITE_API_BASE_URL` nicht auf ein eigenes Backend zeigt.

Die erwartete Pages-URL für das Repo `2dCADCAM` ist:

```text
https://inherjer.github.io/2dCADCAM/
```

Wenn später ein separates API-Backend existiert, kann die Action beim Build `VITE_API_BASE_URL=https://dein-backend.example.com` setzen. Der OpenAI-Key gehört nur in dieses Backend, nicht in GitHub Pages.

## API-Key und ChatGPT Pro

ChatGPT Pro und die OpenAI API sind getrennte Produkte mit getrennten Abrechnungen. Ein Pro-Abo gibt dir nicht automatisch API-Guthaben. Einen API-Key erstellst du in der OpenAI Platform unter den API-Key-/Project-Einstellungen und hinterlegst ihn lokal als `OPENAI_API_KEY`.

## Bring your own key

Die GitHub-Pages-App hat ein BYOK-Panel:

- Provider: `OpenAI` oder `Gemini`
- Modell: z. B. `gpt-5.5` oder `gemini-2.5-flash`
- API-Key: wird standardmäßig nur im Speicher der aktuell geöffneten Seite gehalten
- Optional: für die Browser-Sitzung in `sessionStorage` merken

Im BYOK-Direktmodus geht der Key nicht an unser Backend, sondern direkt aus dem Browser an den gewählten Anbieter. Das ist praktisch zum Testen, aber für Produktionsbetrieb bleibt ein eigenes Backend sicherer, weil Browser-Code und Browser-Erweiterungen grundsätzlich Zugriff auf clientseitige Secrets bekommen können.

## MVP-Fähigkeiten

- Drag-and-drop für DXF, PDF, PNG und JPG
- Lokaler DXF-Parser für `LINE`, `CIRCLE`, `ARC`, `LWPOLYLINE`
- Feature-Inferenz für Konturen, Bohrungen und Gravurpfade
- CNC-Parameterpanel für Werkzeug, Tiefe, Vorschübe, Spindel und Postprozessor
- Three.js-Vorschau für Rohteil, Geometrie und Werkzeugpfade
- G-Code-Ausgabe im generischen GRBL/LinuxCNC-Stil
- OpenAI Responses API Adapter für strukturierte PDF/Bild-Analyse

## Grenzen

Diese Version ist ein Planungs- und Prüfwerkzeug, noch kein zertifizierter CAM-Postprozessor. G-Code vor Maschinenlauf immer in einem Simulator und mit der echten Maschinenkonfiguration prüfen.
