import { useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, Flame, RefreshCw, Tag } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

const API_BASE = "http://127.0.0.1:8000";
const CATEGORY_ORDER = ["neutral", "productive", "distracting"];
const CATEGORY_LABELS = {
  neutral: "Neutral",
  productive: "Productive",
  distracting: "Distracting"
};

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function fmtMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value || 0)));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function totalMinutes(usage = {}) {
  return Object.values(usage).reduce((sum, minutes) => sum + Number(minutes || 0), 0);
}

function categoryFor(domain, categories) {
  return categories[domain] || "neutral";
}

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

function sameWeekdayBaseline(history, dateKey, domain = null) {
  const today = new Date(`${dateKey}T00:00:00`);
  const values = [];

  for (let offset = 1; offset <= 8; offset += 1) {
    const key = localDateKey(addDays(today, offset * -7));
    const usage = history[key];
    if (usage) {
      values.push(domain ? Number(usage[domain] || 0) : totalMinutes(usage));
    }
  }

  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function lastSevenRows(history, topDomains) {
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index - 6);
    const key = localDateKey(date);
    const row = {
      date: key.slice(5),
      fullDate: key
    };
    for (const domain of topDomains) {
      row[domain] = Math.round(Number(history[key]?.[domain] || 0));
    }
    return row;
  });
}

function streakDays(history) {
  let streak = 0;
  let cursor = new Date();

  while (true) {
    const key = localDateKey(cursor);
    if (totalMinutes(history[key]) <= 0) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

function heatmapDays(history) {
  const today = new Date();
  return Array.from({ length: 56 }, (_, index) => {
    const date = addDays(today, index - 55);
    const key = localDateKey(date);
    const minutes = totalMinutes(history[key]);
    return { key, day: date.getDate(), minutes };
  });
}

function heatLevel(minutes) {
  if (minutes >= 240) return 4;
  if (minutes >= 120) return 3;
  if (minutes >= 45) return 2;
  if (minutes > 0) return 1;
  return 0;
}

function nextCategory(category) {
  const index = CATEGORY_ORDER.indexOf(category);
  return CATEGORY_ORDER[(index + 1) % CATEGORY_ORDER.length];
}

function StatCard({ icon: Icon, label, value, meta }) {
  return (
    <section className="stat-card">
      <div className="stat-icon"><Icon size={18} /></div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{meta}</small>
      </div>
    </section>
  );
}

function DomainCard({ item, onToggleCategory }) {
  const baseline = Math.max(1, item.baseline);
  const percent = Math.min(160, Math.round((item.minutes / baseline) * 100));

  return (
    <article className="domain-card">
      <header>
        <div>
          <h3>{item.domain}</h3>
          <p>{fmtMinutes(item.minutes)} today</p>
        </div>
        <button
          className={`category-tag ${item.category}`}
          type="button"
          onClick={() => onToggleCategory(item.domain, item.category)}
          title="Toggle category"
        >
          <Tag size={12} />
          {CATEGORY_LABELS[item.category]}
        </button>
      </header>
      <div className="baseline-row">
        <span>{fmtMinutes(item.baseline)} baseline</span>
        <span>{percent}%</span>
      </div>
      <div className="mini-bar" aria-hidden="true">
        <div style={{ width: `${percent}%` }} />
      </div>
    </article>
  );
}

export default function App() {
  const [data, setData] = useState({
    usage: {},
    history: {},
    categories: {},
    insights: null,
    loadedAt: null,
    error: ""
  });

  async function load() {
    try {
      const today = localDateKey();
      const [usageResult, historyResult, categoryResult, insightsResult] = await Promise.all([
        fetchJson(`/usage?date=${today}`),
        fetchJson("/usage/history"),
        fetchJson("/categories"),
        fetchJson(`/insights?date=${today}`)
      ]);

      setData({
        usage: usageResult.usage || {},
        history: historyResult.history || {},
        categories: Object.fromEntries(
          (categoryResult.categories || []).map((item) => [item.domain, item.category])
        ),
        insights: insightsResult,
        loadedAt: new Date(),
        error: ""
      });
    } catch (error) {
      setData((current) => ({
        ...current,
        error: "Backend offline",
        loadedAt: new Date()
      }));
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  const model = useMemo(() => {
    const today = localDateKey();
    const entries = Object.entries(data.usage)
      .map(([domain, minutes]) => ({
        domain,
        minutes: Number(minutes || 0),
        baseline: data.insights?.domains?.[domain]?.baseline_minutes ?? sameWeekdayBaseline(data.history, today, domain),
        category: categoryFor(domain, data.categories)
      }))
      .filter((item) => item.minutes > 0)
      .sort((left, right) => right.minutes - left.minutes);
    const total = totalMinutes(data.usage);
    const baseline = sameWeekdayBaseline(data.history, today);
    const delta = baseline > 0 ? Math.round(((total - baseline) / baseline) * 100) : 0;
    const topThree = entries.slice(0, 3).map((item) => item.domain);

    return {
      today,
      entries,
      total,
      topDomain: entries[0] || null,
      baseline,
      delta,
      chartRows: lastSevenRows(data.history, topThree),
      topThree,
      streak: streakDays(data.history),
      heatmap: heatmapDays(data.history)
    };
  }, [data]);

  async function toggleCategory(domain, category) {
    const next = nextCategory(category);
    setData((current) => ({
      ...current,
      categories: { ...current.categories, [domain]: next }
    }));

    try {
      await fetch(`${API_BASE}/categories/${encodeURIComponent(domain)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: next })
      });
    } catch (_error) {
      setData((current) => ({
        ...current,
        error: "Category will retry after backend returns"
      }));
    }
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>LifeCycle</h1>
            <p>{model.today}</p>
          </div>
          <button className="icon-button" type="button" onClick={load} title="Refresh" aria-label="Refresh">
            <RefreshCw size={18} />
          </button>
        </header>

        <section className="stats-grid" aria-label="Today summary">
          <StatCard icon={Activity} label="Today" value={fmtMinutes(model.total)} meta="tracked active time" />
          <StatCard
            icon={Tag}
            label="Top domain"
            value={model.topDomain?.domain || "-"}
            meta={model.topDomain ? fmtMinutes(model.topDomain.minutes) : "no data yet"}
          />
          <StatCard
            icon={CalendarDays}
            label="Same weekday"
            value={model.baseline ? `${model.delta >= 0 ? "+" : ""}${model.delta}%` : "-"}
            meta={`${fmtMinutes(model.baseline)} baseline`}
          />
        </section>

        <section className="domain-grid" aria-label="Domain breakdown">
          {model.entries.length ? (
            model.entries.map((item) => (
              <DomainCard key={item.domain} item={item} onToggleCategory={toggleCategory} />
            ))
          ) : (
            <div className="empty-panel">No usage has been synced for today.</div>
          )}
        </section>

        <section className="chart-panel" aria-label="Last seven days">
          <header>
            <div>
              <h2>Last 7 Days</h2>
              <p>Top 3 domains</p>
            </div>
          </header>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={model.chartRows}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={38} />
              <Tooltip formatter={(value) => fmtMinutes(value)} />
              {model.topThree.map((domain, index) => (
                <Bar
                  key={domain}
                  dataKey={domain}
                  stackId="domains"
                  fill={["#2563eb", "#16a34a", "#f59e0b"][index]}
                  radius={index === model.topThree.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </section>
      </section>

      <aside className="sidebar">
        <section className="streak-panel">
          <div className="stat-icon"><Flame size={18} /></div>
          <span>Streak</span>
          <strong>{model.streak}</strong>
          <small>consecutive tracked days</small>
        </section>

        <section className="heatmap-panel">
          <header>
            <h2>Weekly Heatmap</h2>
            <p>Last 8 weeks</p>
          </header>
          <div className="heatmap-grid">
            {model.heatmap.map((day) => (
              <span
                key={day.key}
                className={`heat level-${heatLevel(day.minutes)}`}
                title={`${day.key}: ${fmtMinutes(day.minutes)}`}
              />
            ))}
          </div>
        </section>

        <section className="sync-panel">
          <span>{data.error || "Live"}</span>
          <small>{data.loadedAt ? `Updated ${data.loadedAt.toLocaleTimeString()}` : "Waiting for data"}</small>
        </section>
      </aside>
    </main>
  );
}
