import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { MetricCard } from "../components/MetricCard";
import { fmtMinutes, shortDate } from "../format";
import type { DashboardData } from "../types";

type FocusPageProps = {
  data: DashboardData;
};

export function FocusPage({ data }: FocusPageProps) {
  return (
    <div className="page-grid">
      <section className="metric-grid three wide">
        <MetricCard label="Average quality" value={data.focus.averageQuality == null ? "-" : `${data.focus.averageQuality}/100`} helper={data.profiles.focusDecay.label} />
        <MetricCard label="Focus sessions" value={`${data.summary.focusSessionCount}`} helper="Completed task-profile sessions" />
        <MetricCard label="Longest streak" value={fmtMinutes(data.summary.longestFocusStreakMinutes)} helper="Productive sessions merged across short gaps" />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Session Lengths</h2>
            <p>Distribution of completed focus sessions.</p>
          </div>
        </div>
        <div className="chart-medium">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.focus.distribution}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
              <Tooltip />
              <Bar dataKey="sessions" fill="#1f8a5b" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <h2>Quality Trend</h2>
            <p>Task session score over recent completed focus sessions.</p>
          </div>
        </div>
        <div className="chart-medium">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.focus.qualityTrend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={36} />
              <Tooltip formatter={(value, name) => [name === "durationMinutes" ? fmtMinutes(Number(value)) : value, name]} />
              <Line type="monotone" dataKey="qualityScore" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="durationMinutes" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
