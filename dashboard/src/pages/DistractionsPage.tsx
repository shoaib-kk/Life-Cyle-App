import { MetricCard } from "../components/MetricCard";
import { fmtMinutes } from "../format";
import type { DashboardData } from "../types";

type DistractionsPageProps = {
  data: DashboardData;
};

export function DistractionsPage({ data }: DistractionsPageProps) {
  const distractingDomains = data.domains.domains.filter((domain) => domain.productivity === "distracting");
  const leakageProfiles = data.profiles.profiles
    .filter((profile) => profile.leakageRate > 0)
    .sort((left, right) => right.leakageRate - left.leakageRate);

  return (
    <div className="page-grid">
      <section className="metric-grid three wide">
        <MetricCard label="Distracting time" value={fmtMinutes(data.summary.totals.distractingMinutes)} helper={`${data.summary.totals.distractingRatio}% of tracked time`} tone="bad" />
        <MetricCard label="Context switches" value={`${data.summary.contextSwitchCount}`} helper="Session endings caused by tab changes" tone="warn" />
        <MetricCard label="Focus decay" value={`${data.summary.focusDecay.delta}`} helper={data.summary.focusDecay.label} />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Distracting Domains</h2>
            <p>Domains marked as distracting or inferred from defaults.</p>
          </div>
        </div>
        <div className="stack-list">
          {distractingDomains.map((domain) => (
            <div className="stack-row" key={domain.domain}>
              <div>
                <strong>{domain.domain}</strong>
                <span>{domain.category}</span>
              </div>
              <em>{fmtMinutes(domain.minutes)}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <h2>Profile Leakage</h2>
            <p>Distracting activity that happened while a task profile was active.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Leakage</th>
                <th>Blocked time</th>
                <th>Blocked attempts</th>
                <th>Top distracting domains</th>
              </tr>
            </thead>
            <tbody>
              {leakageProfiles.map((profile) => (
                <tr key={profile.profileId}>
                  <td>{profile.profileName}</td>
                  <td>{profile.leakageRate}%</td>
                  <td>{fmtMinutes(profile.blockedMinutes)}</td>
                  <td>{profile.blockedAttempts}</td>
                  <td>
                    {profile.mostDistractingDomains.length
                      ? profile.mostDistractingDomains.map((item) => `${item.domain} (${item.count})`).join(", ")
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
