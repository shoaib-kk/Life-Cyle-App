import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { fmtMinutes, shortDate } from "../format";
import type { DashboardData } from "../types";

type TrendsPageProps = {
  data: DashboardData;
};

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function TrendsPage({ data }: TrendsPageProps) {
  const maxHeat = Math.max(...data.timeSeries.hourlyHeatmap.map((item) => item.minutes), 1);

  return (
    <div className="page-grid">
      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <h2>Daily Trend</h2>
            <p>Total active usage by day.</p>
          </div>
        </div>
        <div className="chart-tall">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.timeSeries.daily}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 60)}h`} tickLine={false} axisLine={false} width={36} />
              <Tooltip formatter={(value) => fmtMinutes(Number(value))} />
              <Area type="monotone" dataKey="minutes" stroke="#2563eb" fill="#dbeafe" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <h2>Weekly Trend</h2>
            <p>Weekly totals make the long-term pattern easier to scan.</p>
          </div>
        </div>
        <div className="chart-medium">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.timeSeries.weekly}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="weekStart" tickFormatter={shortDate} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 60)}h`} tickLine={false} axisLine={false} width={36} />
              <Tooltip formatter={(value) => fmtMinutes(Number(value))} />
              <Bar dataKey="minutes" fill="#1f8a5b" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <h2>Hourly Heatmap</h2>
            <p>Usage intensity by weekday and hour.</p>
          </div>
        </div>
        <div className="heatmap">
          <div className="heatmap-corner" />
          {Array.from({ length: 24 }, (_, hour) => (
            <div className="heatmap-hour" key={hour}>{hour}</div>
          ))}
          {weekdays.map((day, weekday) => (
            <div className="heatmap-row" key={day}>
              <div className="heatmap-day">{day}</div>
              {Array.from({ length: 24 }, (_, hour) => {
                const bucket = data.timeSeries.hourlyHeatmap.find(
                  (item) => item.weekday === weekday && item.hour === hour
                );
                const opacity = Math.max(0.08, Number(bucket?.minutes || 0) / maxHeat);
                return (
                  <div
                    className="heatmap-cell"
                    key={hour}
                    title={`${day} ${hour}:00 - ${fmtMinutes(bucket?.minutes || 0)}`}
                    style={{ backgroundColor: `rgba(37, 99, 235, ${opacity})` }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
