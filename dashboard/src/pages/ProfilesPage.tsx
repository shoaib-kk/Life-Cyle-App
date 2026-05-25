import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "../components/EmptyState";
import { fmtMinutes } from "../format";
import type { DashboardData } from "../types";

type ProfilesPageProps = {
  data: DashboardData;
};

export function ProfilesPage({ data }: ProfilesPageProps) {
  const profiles = data.profiles.profiles;

  return (
    <div className="page-grid">
      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <h2>Task Profile Time</h2>
            <p>Focus minutes grouped by Coding, Studying, Job Hunting, and other profiles.</p>
          </div>
        </div>
        <div className="chart-medium">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={profiles}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="profileName" tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 60)}h`} tickLine={false} axisLine={false} width={36} />
              <Tooltip formatter={(value) => fmtMinutes(Number(value))} />
              <Bar dataKey="totalFocusMinutes" fill="#2563eb" radius={[5, 5, 0, 0]} />
              <Bar dataKey="blockedMinutes" fill="#d64f4f" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {profiles.length ? (
        profiles.map((profile) => (
          <section className="panel profile-panel" key={profile.profileId}>
            <div className="profile-title">
              <div>
                <h2>{profile.profileName}</h2>
                <p>{profile.group}</p>
              </div>
              <strong>{profile.averageQuality ?? "-"}<span>/100</span></strong>
            </div>
            <div className="profile-stats">
              <span>{fmtMinutes(profile.totalFocusMinutes)} focus</span>
              <span>{profile.sessionCount} sessions</span>
              <span>{profile.leakageRate}% leakage</span>
            </div>
            <div className="leak-list">
              {profile.mostDistractingDomains.length ? (
                profile.mostDistractingDomains.map((item) => (
                  <div key={item.domain}>
                    <span>{item.domain}</span>
                    <strong>{item.count}</strong>
                  </div>
                ))
              ) : (
                <p>No distracting domains recorded for this profile.</p>
              )}
            </div>
          </section>
        ))
      ) : (
        <section className="panel">
          <EmptyState title="No profile sessions" body="Start and stop task profiles from the extension popup to build this view." />
        </section>
      )}
    </div>
  );
}
