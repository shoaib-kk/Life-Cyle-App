import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { EmptyState } from "../components/EmptyState";
import { fmtMinutes } from "../format";
import type { DashboardData, Productivity } from "../types";

type BreakdownPageProps = {
  data: DashboardData;
};

const colors: Record<Productivity, string> = {
  productive: "#1f8a5b",
  distracting: "#d64f4f",
  neutral: "#718096"
};

export function BreakdownPage({ data }: BreakdownPageProps) {
  const domains = data.domains.domains;
  const categoryData = [
    { name: "Productive", value: data.domains.categoryTotals.productiveMinutes, key: "productive" as const },
    { name: "Distracting", value: data.domains.categoryTotals.distractingMinutes, key: "distracting" as const },
    { name: "Neutral", value: data.domains.categoryTotals.neutralMinutes, key: "neutral" as const }
  ];

  return (
    <div className="page-grid">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Category Breakdown</h2>
            <p>Domain-level categorization for productivity scoring.</p>
          </div>
        </div>
        <div className="chart-medium">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90}>
                {categoryData.map((entry) => (
                  <Cell key={entry.key} fill={colors[entry.key]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => fmtMinutes(Number(value))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <h2>Top Domains</h2>
            <p>Time, share, category, and average session length.</p>
          </div>
        </div>
        {domains.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Category</th>
                  <th>Time</th>
                  <th>Share</th>
                  <th>Sessions</th>
                  <th>Avg session</th>
                </tr>
              </thead>
              <tbody>
                {domains.map((domain) => (
                  <tr key={domain.domain}>
                    <td>{domain.domain}</td>
                    <td>
                      <span className={`tag ${domain.productivity}`}>{domain.category}</span>
                    </td>
                    <td>{fmtMinutes(domain.minutes)}</td>
                    <td>{domain.percentage}%</td>
                    <td>{domain.sessionCount ?? "-"}</td>
                    <td>{domain.averageSessionMinutes == null ? "-" : fmtMinutes(domain.averageSessionMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No domains yet" body="Once the extension syncs usage, domains will appear here." />
        )}
      </section>
    </div>
  );
}
