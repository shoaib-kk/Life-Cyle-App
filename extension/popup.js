let refreshTimer = null;

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = byId(id);
  if (!el) return;
  el.textContent = text;
}

function formatMinutes(minutes) {
  if (typeof minutes === "number") {
    return `${Math.round(minutes)} min`;
  }

  return String(minutes || "-");
}

function formatDateLabel(dateKey) {
  const [, month, day] = String(dateKey).split("-");
  return `${Number(month)}/${Number(day)}`;
}

function usageEntries(summary) {
  return Object.entries(summary.usage || {})
    .map(([domain, minutes]) => [domain, Number(minutes || 0)])
    .filter(([, minutes]) => minutes > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5);
}

function renderLeaderboard(summary) {
  const list = byId("siteLeaderboard");
  const entries = usageEntries(summary);
  const topMinutes = entries[0]?.[1] || 0;
  const totalMinutes = entries.reduce((total, [, minutes]) => total + minutes, 0);

  list.replaceChildren();

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "No site usage recorded yet";
    list.append(empty);
    return;
  }

  for (const [domain, minutes] of entries) {
    const percentOfTotal = totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0;
    const barPercent = topMinutes > 0 ? Math.max(6, Math.round((minutes / topMinutes) * 100)) : 0;
    const row = document.createElement("div");
    const label = document.createElement("span");
    const meta = document.createElement("span");
    const track = document.createElement("span");
    const fill = document.createElement("span");

    row.className = domain === summary.domain ? "site-row active" : "site-row";
    label.className = "site-domain";
    meta.className = "site-meta";
    track.className = "bar-track";
    fill.className = "bar-fill";

    label.textContent = domain;
    meta.textContent = `${formatMinutes(minutes)} - ${percentOfTotal}%`;
    fill.style.width = `${barPercent}%`;

    track.append(fill);
    row.append(label, meta, track);
    list.append(row);
  }
}

function renderInsights(summary) {
  const list = byId("insightsList");
  const insights = summary.insights || [];

  list.replaceChildren();

  for (const insight of insights) {
    const item = document.createElement("li");
    item.textContent = insight;
    list.append(item);
  }
}

function renderDailyChart(summary) {
  const chart = byId("dailyChart");
  const days = summary.weeklyTrends?.dailyTotals || [];

  chart.replaceChildren();

  for (const day of days) {
    const dayEl = document.createElement("div");
    const bar = document.createElement("span");
    const label = document.createElement("span");
    const barPercent = Math.max(4, Number(day.barPercent || 0));

    dayEl.className = "chart-day";
    bar.className = "chart-bar";
    label.textContent = formatDateLabel(day.date);
    dayEl.title = `${day.date}: ${formatMinutes(day.minutes)}`;
    bar.style.height = `${Math.min(100, barPercent)}%`;

    dayEl.append(bar, label);
    chart.append(dayEl);
  }
}

function renderWeeklyTopSites(summary) {
  const list = byId("weeklyTopSites");
  const sites = summary.weeklyTrends?.topSites || [];

  list.replaceChildren();

  if (sites.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "No weekly site data yet";
    list.append(empty);
    return;
  }

  for (const site of sites) {
    const row = document.createElement("div");
    const label = document.createElement("span");
    const meta = document.createElement("span");

    row.className = "weekly-site";
    label.textContent = site.domain;
    meta.textContent = formatMinutes(site.minutes);
    row.append(label, meta);
    list.append(row);
  }
}

function renderTrends(summary) {
  const trends = summary.weeklyTrends || {};
  const categoryTotals = trends.categoryTotals || {};

  renderDailyChart(summary);
  setText("productiveRatio", `${categoryTotals.productiveRatio || 0}%`);
  setText("distractingRatio", `${categoryTotals.distractingRatio || 0}%`);
  setText("averageSessionLength", formatMinutes(trends.averageSessionLength || 0));
  setText("weeklySwitches", String(trends.contextSwitchCount || 0));
  renderWeeklyTopSites(summary);
}

function renderDebug(summary) {
  const panel = byId("debugPanel");
  const debug = summary.debug || {};
  const rows = [
    ["currentDomain", debug.currentDomain],
    ["activeSession.domain", debug.activeSessionDomain],
    ["startedAt", debug.startedAt],
    ["lastCheckpointAt", debug.lastCheckpointAt],
    ["idleState", debug.idleState],
    ["focusedWindow", debug.focusedWindow],
    ["activeTab.url", debug.activeTabUrl]
  ];

  panel.replaceChildren();

  for (const [label, value] of rows) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const details = document.createElement("dd");

    row.className = "debug-row";
    term.textContent = label;
    details.textContent = value || "-";
    row.append(term, details);
    panel.append(row);
  }
}

function setMinutes(id, value) {
  const el = byId(id);
  if (!el) return;
  el.textContent = formatMinutes(value);
}

function setOptionalText(id, text) {
  const el = byId(id);
  if (!el) return;
  el.textContent = text || "";
  el.hidden = !text;
}

function sessionToggleSummary(summary) {
  const minutes = formatMinutes(summary.currentSessionMinutes);
  const status = summary.sessionStatus || "No active tab";
  return `${minutes} - ${status}`;
}

function renderControls(summary) {
  const categorySelect = byId("categorySelect");
  const pauseButton = byId("pauseTracking");
  const resumeButton = byId("resumeTracking");
  const excludeButton = byId("excludeCurrentSite");
  const hasCurrentDomain = Boolean(summary.currentDomain);

  categorySelect.value = summary.currentDomainCategory || summary.domainCategory || "neutral";
  categorySelect.disabled = !hasCurrentDomain;
  pauseButton.disabled = Boolean(summary.trackingPaused);
  resumeButton.disabled = !summary.trackingPaused;
  excludeButton.disabled = !hasCurrentDomain || summary.currentSiteExcluded;
  excludeButton.textContent = summary.currentSiteExcluded ? "Excluded" : "Exclude site";
}

function render(summary) {
  const domainLabel = summary.domain || "No domain tracked yet";
  const resetTime = byId("resetTime");

  setText("domain", summary.trackingPaused ? `${domainLabel} - paused` : domainLabel);
  resetTime.value = String(summary.settings?.dailyResetHour || 0);
  setText("dailyCardTitle", summary.domain ? `Today's usage on ${summary.domain}` : "Today's usage");
  setText("sessionToggleSummary", sessionToggleSummary(summary));
  setMinutes("currentSession", summary.currentSessionMinutes);
  setMinutes("typicalSession", summary.typicalSessionMinutes);
  setText("sessionStatus", summary.sessionStatus);
  setText("sessionPercentile", summary.sessionPercentileText);
  setText("sessionConfidence", summary.sessionConfidence);
  setOptionalText("sessionRecommendation", summary.sessionRecommendation);
  setMinutes("today", summary.todayMinutes);
  setMinutes("average", summary.averageMinutes);
  setText("status", summary.status);
  setText("baselineConfidence", summary.baselineConfidence);
  setText("prediction", summary.prediction);
  setOptionalText("recommendation", summary.recommendation);
  renderControls(summary);
  renderInsights(summary);
  renderTrends(summary);
  renderLeaderboard(summary);
  renderDebug(summary);
}

function fallbackSummary() {
  return {
    domain: null,
    currentDomain: null,
    trackingPaused: false,
    currentSiteExcluded: false,
    settings: { dailyResetHour: 0 },
    currentSessionMinutes: 0,
    typicalSessionMinutes: "-",
    sessionStatus: "No active tab",
    sessionPercentileText: "-",
    sessionConfidence: "-",
    sessionRecommendation: "",
    todayMinutes: 0,
    averageMinutes: "-",
    status: "-",
    baselineConfidence: "-",
    prediction: "-",
    recommendation: "",
    currentDomainCategory: "neutral",
    domainCategory: "neutral",
    insights: ["Keep browsing to build insights"],
    weeklyTrends: {
      dailyTotals: [],
      categoryTotals: {
        productiveRatio: 0,
        distractingRatio: 0
      },
      topSites: [],
      averageSessionLength: 0,
      contextSwitchCount: 0
    },
    debug: {},
    usage: {}
  };
}

function sendAction(type, payload = {}) {
  chrome.runtime.sendMessage({ type, ...payload }, (summary) => {
    if (chrome.runtime.lastError || !summary) {
      return;
    }

    render(summary);
  });
}

function saveSettings() {
  const dailyResetHour = Number(byId("resetTime").value);
  sendAction("SAVE_SETTINGS", {
    settings: { dailyResetHour }
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

function setupActiveSessionToggle() {
  const card = document.querySelector(".active-card");
  const button = byId("activeSessionToggle");
  const panel = byId("activeSessionPanel");

  if (!card || !button || !panel) {
    return;
  }

  button.addEventListener("click", () => {
    const isOpen = button.getAttribute("aria-expanded") === "true";
    const shouldOpen = !isOpen;

    button.setAttribute("aria-expanded", String(shouldOpen));
    panel.hidden = !shouldOpen;
    card.classList.toggle("open", shouldOpen);
  });
}

function setupDebugToggle() {
  const card = document.querySelector(".debug-card");
  const button = byId("debugToggle");
  const panel = byId("debugPanel");

  if (!card || !button || !panel) {
    return;
  }

  button.addEventListener("click", () => {
    const isOpen = button.getAttribute("aria-expanded") === "true";
    const shouldOpen = !isOpen;

    button.setAttribute("aria-expanded", String(shouldOpen));
    panel.hidden = !shouldOpen;
    card.classList.toggle("open", shouldOpen);
  });
}

function setupControls() {
  byId("resetTime").addEventListener("change", saveSettings);
  byId("pauseTracking").addEventListener("click", () => sendAction("PAUSE_TRACKING"));
  byId("resumeTracking").addEventListener("click", () => sendAction("RESUME_TRACKING"));
  byId("excludeCurrentSite").addEventListener("click", () => sendAction("EXCLUDE_CURRENT_SITE"));
  byId("categorySelect").addEventListener("change", (event) => {
    sendAction("SET_CURRENT_SITE_CATEGORY", { category: event.target.value });
  });
  byId("resetToday").addEventListener("click", () => {
    if (window.confirm("Reset today's usage and session data?")) {
      sendAction("RESET_TODAY");
    }
  });
  byId("clearAllData").addEventListener("click", () => {
    if (window.confirm("Clear all usage data, sessions, exclusions, and categories?")) {
      sendAction("CLEAR_ALL_DATA");
    }
  });
}

function startRefreshTimer() {
  if (refreshTimer) {
    return;
  }

  refreshSummary();
  refreshTimer = setInterval(refreshSummary, 1000);
}

function stopRefreshTimer() {
  if (!refreshTimer) {
    return;
  }

  clearInterval(refreshTimer);
  refreshTimer = null;
}

setupActiveSessionToggle();
setupDebugToggle();
setupControls();
startRefreshTimer();

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopRefreshTimer();
    return;
  }

  startRefreshTimer();
});
