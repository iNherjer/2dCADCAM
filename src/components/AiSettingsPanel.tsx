import { KeyRound, ShieldAlert } from "lucide-react";
import type { ClientAiSettings } from "../../shared/schema";

type Props = {
  settings: ClientAiSettings;
  onChange: (settings: ClientAiSettings) => void;
};

const providerDefaults = {
  none: "",
  openai: "gpt-5.5",
  gemini: "gemini-2.5-pro"
} as const;

export function AiSettingsPanel({ settings, onChange }: Props) {
  function update(next: Partial<ClientAiSettings>) {
    const merged = { ...settings, ...next };
    onChange(merged);
    if (merged.rememberForSession) {
      sessionStorage.setItem("cnc-ai-settings", JSON.stringify({ ...merged, apiKey: merged.apiKey }));
    } else {
      sessionStorage.removeItem("cnc-ai-settings");
    }
  }

  return (
    <section className="ai-panel">
      <div className="panel-header small">
        <KeyRound size={18} />
        <h2>Bring your own key</h2>
      </div>

      <div className="ai-grid">
        <label className="field">
          <span>Provider</span>
          <select
            value={settings.provider}
            onChange={(event) => {
              const provider = event.target.value as ClientAiSettings["provider"];
              update({ provider, model: providerDefaults[provider] });
            }}
          >
            <option value="none">Aus</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>

        <label className="field">
          <span>Modell</span>
          <input
            type="text"
            value={settings.model}
            disabled={settings.provider === "none"}
            placeholder={settings.provider === "gemini" ? "gemini-2.5-pro" : "gpt-5.5"}
            onChange={(event) => update({ model: event.target.value })}
          />
        </label>

        <label className="field full">
          <span>API-Key</span>
          <input
            type="password"
            value={settings.apiKey}
            disabled={settings.provider === "none"}
            autoComplete="off"
            spellCheck={false}
            placeholder={settings.provider === "none" ? "Provider aktivieren" : "Key wird nur im Browser verwendet"}
            onChange={(event) => update({ apiKey: event.target.value })}
          />
        </label>

        <label className="check-row full">
          <input
            type="checkbox"
            checked={settings.rememberForSession}
            onChange={(event) => update({ rememberForSession: event.target.checked })}
          />
          Fuer diese Browser-Sitzung merken
        </label>

        <div className="key-warning full">
          <ShieldAlert size={16} />
          <span>Direktmodus: Der Key wird nicht an unseren Server gesendet, aber der Browser muss ihn fuer den Anbieter-Request verwenden.</span>
        </div>
      </div>
    </section>
  );
}
