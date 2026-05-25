import { CalendarDays } from "lucide-react";
import { MetricCard } from "../components/MetricCard";
import { fmtMinutes } from "../format";
import type { DashboardData } from "../types";

type GoalsReportsPageProps = {
  data: DashboardData;
};

export function GoalsReportsPage({ data }: GoalsReportsPageProps) {
  const report = data.weeklyReport.metrics;

  return (
    <div className="page-grid">
      <section className="metric-grid four wide">
        <MetricCard label="Weekly score" value={report.productivityScore == null ? "-" : `${report.productivityScore}`} helper={`${report.weekStart} to ${report.weekEnd}`} />
        <MetricCard label="Productive" value={fmtMinutes(report.productiveMinutes)} helper="This week" tone="good" />
        <MetricCard label="Distracting" value={fmtMinutes(report.distractingMinutes)} helper="This week" tone="bad" />
        <MetricCard label="Context switches" value={`${report.contextSwitchCount}`} helper="This week" tone="warn" />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Goals</h2>
            <p>Weekly targets from the backend goals table.</p>
          </div>
        </div>
        <div className="stack-list">
          {data.goals.map((goal) => (
            <div className="stack-row" key={goal.id}>
              <div>
                <strong>{goal.metric.split("_").join(" ")}</strong>
                <span>{goal.period}{goal.domain ? ` - ${goal.domain}` : ""}</span>
              </div>
              <em>{fmtMinutes(goal.targetMinutes)}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <h2>Weekly Report</h2>
            <p>{data.weeklyReport.narrative}</p>
          </div>
          <CalendarDays size={20} />
        </div>
        <div className="report-grid">
          <div>
            <h3>Top Domains</h3>
            {report.topDomains.map((domain) => (
              <div className="report-row" key={domain.domain}>
                <span>{domain.domain}</span>
                <strong>{fmtMinutes(domain.minutes)}</strong>
              </div>
            ))}
          </div>
          <div>
            <h3>Most Productive Hours</h3>
            {report.mostProductiveHours.map((hour) => (
              <div className="report-row" key={hour.hour}>
                <span>{hour.hour}:00</span>
                <strong>{fmtMinutes(hour.minutes)}</strong>
              </div>
            ))}
          </div>
          <div>
            <h3>Focus Decay</h3>
            <p>{report.focusDecay.label}</p>
            <strong>{report.focusDecay.delta}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
