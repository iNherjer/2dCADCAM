import type { AnalysisResult } from "../../shared/schema";

type Props = {
  result: AnalysisResult | null;
};

export function FeatureList({ result }: Props) {
  const features = result?.analysis.features ?? [];
  const uncertainties = result?.analysis.uncertainties ?? [];

  return (
    <section className="feature-panel">
      <h2>Erkannte Features</h2>
      {features.length === 0 ? <p className="muted">Noch keine verwertbaren Features erkannt.</p> : null}
      <div className="feature-list">
        {features.map((feature) => (
          <article className="feature-card" key={feature.id}>
            <div>
              <strong>{feature.label}</strong>
              <span>{feature.type}</span>
            </div>
            <meter min={0} max={1} value={feature.confidence} />
          </article>
        ))}
      </div>

      {uncertainties.length ? (
        <div className="uncertainties">
          <h3>Zu prüfen</h3>
          {uncertainties.map((item) => (
            <p key={item.id}>{item.message}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
