import { demoData } from "./demoData";
import type {
  DashboardData,
  DashboardSummary,
  FocusAnalytics,
  Goal,
  ProfileAnalytics,
  TimeSeriesData,
  WeeklyReport
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const TOKEN_KEY = "lifecycle_token";

async function apiGet<T>(path: string): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    throw new Error("No dashboard token configured");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function loadDashboardData(days = 30): Promise<DashboardData> {
  try {
    const [summary, timeSeries, domains, profiles, focus, goals, weeklyReport] =
      await Promise.all([
        apiGet<DashboardSummary>(`/dashboard/summary?days=${days}`),
        apiGet<TimeSeriesData>(`/analytics/time-series?days=${days}`),
        apiGet<DashboardData["domains"]>(`/analytics/domains?days=${days}`),
        apiGet<ProfileAnalytics>(`/analytics/profiles?days=${days}`),
        apiGet<FocusAnalytics>(`/analytics/focus-sessions?days=${days}`),
        apiGet<{ goals: Goal[] }>("/goals"),
        apiGet<WeeklyReport>("/reports/weekly")
      ]);

    if (!summary.hasData) {
      return demoData;
    }

    return {
      demoMode: false,
      summary,
      timeSeries,
      domains,
      profiles,
      focus,
      goals: goals.goals,
      weeklyReport
    };
  } catch (_error) {
    return demoData;
  }
}

export function saveDashboardToken(token: string) {
  if (token.trim()) {
    localStorage.setItem(TOKEN_KEY, token.trim());
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function hasDashboardToken() {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}
