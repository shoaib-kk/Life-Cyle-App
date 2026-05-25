type MetricCardProps = {
  label: string;
  value: string;
  helper?: string;
  tone?: "default" | "good" | "warn" | "bad";
};

export function MetricCard({ label, value, helper, tone = "default" }: MetricCardProps) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </article>
  );
}
