import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import SiteList from "../components/SiteList.jsx";
import { FOCUS, IDLE } from "../colors.js";
import { formatMinutes } from "../utils.js";

function WeekTooltip({ active, payload, label }) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-full bg-zinc-100 px-2 py-0.5 text-micro text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
      {label} · {formatMinutes(payload[0].value)}
    </div>
  );
}

WeekTooltip.propTypes = {
  active: PropTypes.bool,
  payload: PropTypes.array,
  label: PropTypes.string
};

WeekTooltip.defaultProps = {
  active: false,
  payload: [],
  label: ""
};

export default function Week({ week, demoMode }) {
  if (!demoMode && week.days.length === 0) {
    return (
      <p className="text-body text-zinc-500 dark:text-zinc-400">
        No week yet — check back after a few days of browsing.{" "}
        <Link to="/" className="text-link hover:underline">Go to Today</Link>
      </p>
    );
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-page text-zinc-900 dark:text-zinc-100">This week</h1>
        <p className="mt-1 text-body text-zinc-400">{week.range}</p>
      </section>

      <section className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={week.days} margin={{ top: 12, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: IDLE, fontSize: 12 }} />
            <YAxis hide />
            <Tooltip content={<WeekTooltip />} cursor={{ fill: "transparent" }} />
            <ReferenceLine y={week.averageMinutes} stroke={IDLE} strokeDasharray="4 4" />
            <Bar dataKey="focus" radius={[3, 3, 0, 0]}>
              {week.days.map((day) => (
                <Cell key={day.label} fill={FOCUS} fillOpacity={day.isToday ? 1 : 0.68} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section>
        <p className="text-body text-zinc-500 dark:text-zinc-400">
          <span className="text-zinc-400">total</span>{" "}
          <span className="text-zinc-900 dark:text-zinc-100">{week.stats.total}</span>
          <span className="px-2">—</span>
          <span className="text-zinc-400">best day</span>{" "}
          <span className="text-zinc-900 dark:text-zinc-100">{week.stats.bestDay}</span>
          <span className="px-2">—</span>
          <span className="text-zinc-400">goals hit</span>{" "}
          <span className="text-zinc-900 dark:text-zinc-100">{week.stats.goalsHit}</span>
        </p>
      </section>

      <section>
        <div className="text-label uppercase tracking-widest text-zinc-400">most visited this week</div>
        <div className="mt-2.5">
          <SiteList sites={week.sites} />
        </div>
      </section>
    </div>
  );
}

Week.propTypes = {
  week: PropTypes.shape({
    range: PropTypes.string.isRequired,
    averageMinutes: PropTypes.number.isRequired,
    days: PropTypes.arrayOf(
      PropTypes.shape({
        day: PropTypes.string.isRequired,
        label: PropTypes.string.isRequired,
        focus: PropTypes.number.isRequired,
        isToday: PropTypes.bool.isRequired
      })
    ).isRequired,
    stats: PropTypes.shape({
      total: PropTypes.string.isRequired,
      bestDay: PropTypes.string.isRequired,
      goalsHit: PropTypes.string.isRequired
    }).isRequired,
    sites: SiteList.propTypes.sites
  }).isRequired,
  demoMode: PropTypes.bool.isRequired
};
