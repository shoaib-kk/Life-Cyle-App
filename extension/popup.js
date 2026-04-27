let refreshTimer = null;

// ── Utilities ────────────────────────────────────────────────

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = byId(id);
  if (el) el.textContent = text;
}

function formatMinutes(minutes) {
  if (typeof minutes !== "number" || isNaN(minutes)) return "—";
  const m = Math.round(minutes);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
  }
  return `${m}m`;
}

function formatDateLabel(dateKey) {
  const [, month, day] = String(dateKey).split("-");
  const days = ["Su","Mo","Tu","We","Th","Fr","Sa"];
  const d = new Date(Number(dateKey.slice(0,4)), Number(month)-1, Number(day));
  return days[d.getDay()];
}

function isToday(dateKey) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2,"0");
  return dateKey === `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
}

// ── Tab navigation ───────────────────────────────────────────

const TABS = ["now", "today", "week"];

function activateTab(name) {
  TABS.forEach((t) => {
    const tab = document.querySelector(`[data-tab="${t}"]`);
    const view = byId(`view-${t}`);
    const isActive = t === name;
    if (tab) {
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    }
    if (view) view.hidden = !isActive;
  });

  // Hide settings when switching tabs
  const settings = byId("settingsPanel");
  const settingsBtn = byId("settingsToggle");
  if (settings && !settings.hidden) {
    settings.hidden = true;
    settingsBtn.setAttribute("aria-expanded", "false");
  }
}

function setupTabs() {
  TABS.forEach((t) => {
    const tab = document.querySelector(`[data-tab="${t}"]`);
    if (tab) tab.addEventListener("click", () => activateTab(t));
  });
}

// ── Settings toggle ──────────────────────────────────────────

function setupSettingsToggle() {
  const btn = byId("settingsToggle");
  const panel = byId("settingsPanel");
  const viewNow = byId("view-now");
  const viewToday = byId("view-today");
  const viewWeek = byId("view-week");

  if (!btn || !panel) return;

  btn.addEventListener("click", () => {
    const isOpen = btn.getAttribute("aria-expanded") === "true";
    const opening = !isOpen;

    btn.setAttribute("aria-expanded", String(opening));
    panel.hidden = !opening;

    // Hide all views while settings is open
    [viewNow, viewToday, viewWeek].forEach((v) => {
      if (v) v.hidden = opening;
    });

    // Also hide tab content area (tabs stay visible)
    if (!opening) {
      // Re-show active tab view
      const activeTab = document.querySelector(".tab.active");
      const activeName = activeTab?.dataset?.tab || "now";
      activateTab(activeName);
    }
  });
}

// ── Render: NOW view ─────────────────────────────────────────

function renderNow(summary) {
  const domain = summary.currentDomain || null;
  const sessionMins = typeof summary.currentSessionMinutes === "number"
    ? summary.currentSessionMinutes
    : null;
  const typicalMins = typeof summary.typicalSessionMinutes === "number"
    ? summary.typicalSessionMinutes
    : null;
  const paused = summary.trackingPaused;

  const liveDot = byId("liveDot");
  const nowDomain = byId("nowDomain");
  const nowTime = byId("nowTime");
  const nowSub = byId("nowSub");
  const signalFill = byId("signalFill");
  const nowInsight = byId("nowInsight");

  // Domain label
  if (domain && !paused) {
    liveDot.classList.add("active");
    nowDomain.textContent = domain;
  } else {
    liveDot.classList.remove("active");
    nowDomain.textContent = paused ? "Tracking paused" : "No active tab";
  }

  // Big time display
  if (sessionMins !== null && sessionMins >= 0 && domain && !paused) {
    nowTime.textContent = formatMinutes(sessionMins);
  } else {
    nowTime.textContent = "—";
  }

  // Sub-line: vs typical
  if (sessionMins !== null && typicalMins !== null && typicalMins > 0 && domain) {
    nowSub.textContent = `Typical: ${formatMinutes(typicalMins)}`;
  } else if (domain && sessionMins !== null) {
    nowSub.textContent = summary.sessionStatus || "Active";
  } else {
    nowSub.textContent = "";
  }

  // Session progress bar (proportion of typical)
  if (sessionMins !== null && typicalMins !== null && typicalMins > 0) {
    const ratio = Math.min(sessionMins / typicalMins, 1.5);
    signalFill.style.width = `${Math.min((ratio / 1.5) * 100, 100)}%`;
    signalFill.classList.toggle("over", sessionMins > typicalMins);
  } else {
    signalFill.style.width = "0%";
    signalFill.classList.remove("over");
  }

  // Single meaningful insight
  nowInsight.innerHTML = buildNowInsight(summary);
}

function buildNowInsight(summary) {
  const {
    currentDomain: domain,
    currentSessionMinutes: sessionMins,
    typicalSessionMinutes: typicalMins,
    sessionPercentile: percentile,
    trackingPaused: paused,
    sessionStatus
  } = summary;

  if (paused) return "Tracking is paused.";
  if (!domain || sessionMins == null) return "Switch to a tab to start tracking.";

  // Over typical — most actionable signal
  if (typeof typicalMins === "number" && typicalMins > 0 && sessionMins > typicalMins) {
    const pctText = percentile != null ? `longer than <strong>${percentile}%</strong> of your past sessions` : "above your typical";
    return `This session on <strong>${domain}</strong> is ${pctText}.`;
  }

  // Within typical — reassuring
  if (typeof typicalMins === "number" && typicalMins > 0) {
    return `Within your typical session length on <strong>${domain}</strong>.`;
  }

  // No history yet
  return `Building session history for <strong>${domain}</strong>.`;
}

// ── Render: TODAY view ───────────────────────────────────────

function renderToday(summary) {
  const todayMins = typeof summary.todayMinutes === "number" ? summary.todayMinutes : null;
  const avgMins = typeof summary.averageMinutes === "number" ? summary.averageMinutes : null;

  setText("todayTotal", todayMins !== null ? formatMinutes(todayMins) : "—");
  setText("todayAvg", avgMins !== null ? formatMinutes(avgMins) : "—");

  // Status chips
  const statusEl = byId("todayStatus");
  const predEl = byId("todayPrediction");

  if (summary.status && summary.status !== "-") {
    statusEl.textContent = summary.status;
    statusEl.className = "status-chip";
    // Colour based on content
    if (summary.status.includes("below") || summary.status === "On your normal pace") {
      statusEl.classList.add("good");
    }
  } else {
    statusEl.textContent = "Tracking…";
    statusEl.className = "status-chip muted";
  }

  if (summary.prediction && summary.prediction !== "-") {
    predEl.textContent = summary.prediction;
    predEl.hidden = false;
  } else {
    predEl.hidden = true;
  }

  // Site leaderboard (top 5)
  renderTodaySites(summary);

  // Single insight
  byId("todayInsight").innerHTML = buildTodayInsight(summary);
}

function renderTodaySites(summary) {
  const list = byId("todaySiteList");
  const entries = Object.entries(summary.usage || {})
    .map(([d, m]) => [d, Number(m || 0)])
    .filter(([, m]) => m > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  list.replaceChildren();

  if (entries.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-msg";
    p.textContent = "No usage recorded yet today.";
    list.append(p);
    return;
  }

  const top = entries[0][1];
  const current = summary.currentDomain;

  for (const [domain, minutes] of entries) {
    const isCurrent = domain === current;
    const barPct = top > 0 ? Math.max(5, Math.round((minutes / top) * 100)) : 0;

    const row = document.createElement("div");
    row.className = "site-row";

    const name = document.createElement("span");
    name.className = `site-row-name${isCurrent ? " current" : ""}`;
    name.textContent = domain;

    const time = document.createElement("span");
    time.className = "site-row-time";
    time.textContent = formatMinutes(minutes);

    const track = document.createElement("span");
    track.className = "site-bar-track";

    const fill = document.createElement("span");
    fill.className = `site-bar-fill${isCurrent ? " current" : ""}`;
    fill.style.width = `${barPct}%`;

    track.append(fill);
    row.append(name, time, track);
    list.append(row);
  }
}

function buildTodayInsight(summary) {
  const insights = summary.insights || [];

  // Filter to only non-trivial insights
  const useful = insights.filter((s) => {
    // Skip the generic fallback
    if (s === "Keep browsing to build insights") return false;
    // Skip raw context switch count if it's zero or just a number dump
    if (/^Context switches today: [01]$/.test(s)) return false;
    return true;
  });

  if (useful.length === 0) {
    if (summary.recommendation && summary.recommendation !== "") {
      return summary.recommendation;
    }
    return "";
  }

  // Return the single most relevant insight
  return useful[0];
}

// ── Render: WEEK view ────────────────────────────────────────

function renderWeek(summary) {
  const trends = summary.weeklyTrends || {};
  const catTotals = trends.categoryTotals || {};

  // Chart
  const chart = byId("weekChart");
  const days = trends.dailyTotals || [];
  chart.replaceChildren();

  for (const day of days) {
    const col = document.createElement("div");
    const bar = document.createElement("span");
    const label = document.createElement("span");

    col.className = `chart-col${isToday(day.date) ? " today" : ""}`;
    bar.className = "chart-bar";
    bar.style.height = `${Math.max(5, Math.min(100, Number(day.barPercent || 0)))}%`;
    col.title = `${day.date}: ${formatMinutes(day.minutes)}`;
    label.textContent = formatDateLabel(day.date);

    col.append(bar, label);
    chart.append(col);
  }

  // Stats
  setText("weekProductive", `${catTotals.productiveRatio || 0}%`);
  setText("weekDistracting", `${catTotals.distractingRatio || 0}%`);
  setText("weekAvgSession", formatMinutes(trends.averageSessionLength || 0));
  setText("weekSwitches", String(trends.contextSwitchCount || 0));

  // Top sites
  const topSitesEl = byId("weekTopSites");
  const topSites = trends.topSites || [];
  topSitesEl.replaceChildren();

  if (topSites.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-msg";
    p.textContent = "No weekly data yet.";
    topSitesEl.append(p);
    return;
  }

  for (const site of topSites) {
    const row = document.createElement("div");
    row.className = "week-site-row";

    const label = document.createElement("span");
    label.textContent = site.domain;

    const time = document.createElement("span");
    time.textContent = formatMinutes(site.minutes);

    row.append(label, time);
    topSitesEl.append(row);
  }
}

// ── Render: Debug ────────────────────────────────────────────

function renderDebug(summary) {
  const panel = byId("debugPanel");
  const debug = summary.debug || {};
  const rows = [
    ["currentDomain",   debug.currentDomain],
    ["session.domain",  debug.activeSessionDomain],
    ["startedAt",       debug.startedAt],
    ["checkpoint",      debug.lastCheckpointAt],
    ["idleState",       debug.idleState],
    ["window",          debug.focusedWindow],
    ["tab.url",         debug.activeTabUrl]
  ];

  panel.replaceChildren();

  for (const [label, value] of rows) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    row.className = "debug-row";
    dt.textContent = label;
    dd.textContent = value || "-";
    row.append(dt, dd);
    panel.append(row);
  }
}

// ── Render: Settings controls ────────────────────────────────

function renderSettings(summary) {
  const categorySelect = byId("categorySelect");
  const pauseButton = byId("pauseTracking");
  const resumeButton = byId("resumeTracking");
  const excludeButton = byId("excludeCurrentSite");
  const hasCurrentDomain = Boolean(summary.currentDomain);

  byId("resetTime").value = String(summary.settings?.dailyResetHour || 0);

  categorySelect.value = summary.currentDomainCategory || summary.domainCategory || "neutral";
  categorySelect.disabled = !hasCurrentDomain;

  pauseButton.disabled = Boolean(summary.trackingPaused);
  resumeButton.disabled = !summary.trackingPaused;

  excludeButton.disabled = !hasCurrentDomain || summary.currentSiteExcluded;
  excludeButton.textContent = summary.currentSiteExcluded ? "Already excluded" : "Exclude this site";
}

// ── Master render ────────────────────────────────────────────

function render(summary) {
  renderNow(summary);
  renderToday(summary);
  renderWeek(summary);
  renderSettings(summary);
  renderDebug(summary);
}

// ── Fallback state ───────────────────────────────────────────

function fallbackSummary() {
  return {
    domain: null,
    currentDomain: null,
    trackingPaused: false,
    currentSiteExcluded: false,
    settings: { dailyResetHour: 0 },
    currentSessionMinutes: null,
    typicalSessionMinutes: null,
    sessionStatus: "No active tab",
    sessionPercentile: null,
    sessionPercentileText: "-",
    sessionRecommendation: "",
    todayMinutes: null,
    averageMinutes: null,
    status: "-",
    baselineConfidence: "-",
    prediction: "-",
    recommendation: "",
    currentDomainCategory: "neutral",
    domainCategory: "neutral",
    insights: [],
    weeklyTrends: {
      dailyTotals: [],
      categoryTotals: { productiveRatio: 0, distractingRatio: 0 },
      topSites: [],
      averageSessionLength: 0,
      contextSwitchCount: 0
    },
    debug: {},
    usage: {}
  };
}

// ── Messaging ────────────────────────────────────────────────

function sendAction(type, payload = {}) {
  chrome.runtime.sendMessage({ type, ...payload }, (summary) => {
    if (chrome.runtime.lastError || !summary) return;
    render(summary);
  });
}

function refreshSummary() {
  chrome.runtime.sendMessage({ type: "GET_USAGE_SUMMARY" }, (summary) => {
    if (chrome.runtime.lastError || !summary) {
      render(fallbackSummary());
      return;
    }
    render(summary);
  });
}

// ── Controls wiring ──────────────────────────────────────────

function setupControls() {
  byId("resetTime").addEventListener("change", () => {
    sendAction("SAVE_SETTINGS", {
      settings: { dailyResetHour: Number(byId("resetTime").value) }
    });
  });

  byId("categorySelect").addEventListener("change", (e) => {
    sendAction("SET_CURRENT_SITE_CATEGORY", { category: e.target.value });
  });

  byId("pauseTracking").addEventListener("click", () => sendAction("PAUSE_TRACKING"));
  byId("resumeTracking").addEventListener("click", () => sendAction("RESUME_TRACKING"));
  byId("excludeCurrentSite").addEventListener("click", () => sendAction("EXCLUDE_CURRENT_SITE"));

  byId("resetToday").addEventListener("click", () => {
    if (window.confirm("Reset today's usage and session data?")) {
      sendAction("RESET_TODAY");
    }
  });

  byId("clearAllData").addEventListener("click", () => {
    if (window.confirm("Clear ALL usage data, sessions, exclusions, and categories? This cannot be undone.")) {
      sendAction("CLEAR_ALL_DATA");
    }
  });
}

// ── Refresh timer ────────────────────────────────────────────

function startRefreshTimer() {
  if (refreshTimer) return;
  refreshSummary();
  refreshTimer = setInterval(refreshSummary, 1000);
}

function stopRefreshTimer() {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
}

// ── Boot ─────────────────────────────────────────────────────

setupTabs();
setupSettingsToggle();
setupControls();
startRefreshTimer();

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopRefreshTimer();
  } else {
    startRefreshTimer();
  }
});
