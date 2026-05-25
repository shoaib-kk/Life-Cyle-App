import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { MetricCard } from "../components/MetricCard";
import { fmtMinutes, fmtScore, hourLabel, shortDate } from "../format";
import type { DashboardData } from "../types";

type OverviewPageProps = {
  data: DashboardData;
};

const categoryColors = {
  productive: "#1f8a5b",
  distracting: "#d64f4f",
  neutral: "#718096"
};

export function OverviewPage({ data }: OverviewPageProps) {
  const { summary } = data;
  const pieData = [
    { name: "Productive", value: summary.totals.productiveMinutes, key: "productive" },
    { name: "Distracting", value: summary.totals.distractingMinutes, key: "distracting" },
    { name: "Neutral", value: summary.totals.neutralMinutes, key: "neutral" }
  ];

  return (
    <div className="page-grid">
      <section className="metric-grid four">
        <MetricCard
          label="Productivity score"
          value={fmtScore(summary.score)}
          helper={summary.scoreDelta == null ? "No prior comparison" : `${summary.scoreDelta >= 0 ? "+" : ""}${summary.scoreDelta} vs prior period`}
          tone={summary.score && summary.score >= 75 ? "good" : "default"}
        />
        <MetricCard label="Today total" value={fmtMinutes(summary.today.totalMinutes)} helper={`${summary.today.productiveRatio}% productive`} />
        <MetricCard label="Context switches" value={`${summary.contextSwitchCount}`} helper="Tab-change session endings" tone={summary.contextSwitchCount > 80 ? "warn" : "default"} />
        <MetricCard label="Longest focus streak" value={fmtMinutes(summary.longestFocusStreakMinutes)} helper={`${summary.focusSessionCount} focus sessions`} />
      </section>

      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <h2>Daily Usage</h2>
            <p>Tracked active-tab time across the selected period.</p>
          </div>
        </div>
        <div className="chart-tall">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.timeSeries.daily.slice(-14)}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 60)}h`} tickLine={false} axisLine={false} width={36} />
              <Tooltip formatter={(value) => fmtMinutes(Number(value))} labelFormatter={(label) => `Date ${label}`} />
              <Bar dataKey="minutes" fill="#2563eb" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Time Mix</h2>
            <p>Productive, distracting, and neutral time.</p>
          </div>
        </div>
        <div className="chart-medium">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2}>
                {pieData.map((entry) => (
                  <Cell key={entry.key} fill={categoryColors[entry.key as keyof typeof categoryColors]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => fmtMinutes(Number(value))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="legend-row">
          {pieData.map((entry) => (
            <span key={entry.key}>
              <i style={{ background: categoryColors[entry.key as keyof typeof categoryColors] }} />
              {entry.name}
            </span>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Best Hours</h2>
            <p>Hours with the most productive time.</p>
          </div>
        </div>
        <div className="rank-list">
          {summary.mostProductiveHours.map((item, index) => (
            <div className="rank-row" key={item.hour}>
              <span>{index + 1}</span>
              <strong>{hourLabel(item.hour)}</strong>
              <em>{fmtMinutes(item.minutes)}</em>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
