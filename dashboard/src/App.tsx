import { RefreshCw } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { hasDashboardToken, loadDashboardData, saveDashboardToken } from "./api";
import { Sidebar, type PageKey } from "./components/Sidebar";
import { BreakdownPage } from "./pages/BreakdownPage";
import { DistractionsPage } from "./pages/DistractionsPage";
import { FocusPage } from "./pages/FocusPage";
import { GoalsReportsPage } from "./pages/GoalsReportsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { ProfilesPage } from "./pages/ProfilesPage";
import { TrendsPage } from "./pages/TrendsPage";
import type { DashboardData } from "./types";

const pageTitles: Record<PageKey, string> = {
  overview: "Overview",
  trends: "Daily and Weekly Trends",
  breakdown: "Site and Category Breakdown",
  profiles: "Task Profile Analytics",
  focus: "Focus Sessions",
  distractions: "Distraction Analysis",
  goals: "Goals and Weekly Reports"
};

function pageSubtitle(page: PageKey, demoMode: boolean) {
  if (demoMode) {
    return "Demo data is active until the dashboard receives an API token with synced extension data.";
  }

  const subtitles: Record<PageKey, string> = {
    overview: "A compact read on current productivity, focus, and time mix.",
    trends: "Longitudinal usage trends and hourly heatmap patterns.",
    breakdown: "Domain-level usage with categories and productivity labels.",
    profiles: "Focus time and leakage by task profile.",
    focus: "Session quality, length distribution, and focus decay.",
    distractions: "Distracting domains, context switching, and profile leakage.",
    goals: "Weekly targets and generated report metrics."
  };
  return subtitles[page];
}

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>("overview");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenDraft, setTokenDraft] = useState("");

  async function refresh() {
    setLoading(true);
    const nextData = await loadDashboardData();
    setData(nextData);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  const page = useMemo(() => {
    if (!data) {
      return null;
    }

    switch (activePage) {
      case "overview":
        return <OverviewPage data={data} />;
      case "trends":
        return <TrendsPage data={data} />;
      case "breakdown":
        return <BreakdownPage data={data} />;
      case "profiles":
        return <ProfilesPage data={data} />;
      case "focus":
        return <FocusPage data={data} />;
      case "distractions":
        return <DistractionsPage data={data} />;
      case "goals":
        return <GoalsReportsPage data={data} />;
      default:
        return <OverviewPage data={data} />;
    }
  }, [activePage, data]);

  function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveDashboardToken(tokenDraft);
    setTokenDraft("");
    refresh();
  }

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onChange={setActivePage} />

      <div className="main-shell">
        <header className="topbar">
          <div>
            <div className="topline">
              <span className={data?.demoMode ? "mode-badge demo" : "mode-badge live"}>
                {data?.demoMode ? "Demo mode" : "Live data"}
              </span>
              <span>{hasDashboardToken() ? "Token configured" : "No token"}</span>
            </div>
            <h1>{pageTitles[activePage]}</h1>
            <p>{pageSubtitle(activePage, Boolean(data?.demoMode))}</p>
          </div>

          <div className="topbar-actions">
            <form className="token-form" onSubmit={submitToken}>
              <input
                aria-label="API token"
                value={tokenDraft}
                onChange={(event) => setTokenDraft(event.target.value)}
                placeholder="Paste API token"
                type="password"
              />
              <button type="submit">Use</button>
            </form>
            <button className="icon-text-btn" type="button" onClick={refresh}>
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </header>

        <main className="content">
          {loading || !data ? (
            <div className="loading-panel">Loading dashboard...</div>
          ) : (
            page
          )}
        </main>
      </div>
    </div>
  );
}
