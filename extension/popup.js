"use strict";

const WEB_DASHBOARD_URL = "http://localhost:5173";
const $ = (id) => document.getElementById(id);

const els = {
  favicon: $("favicon"),
  domainName: $("domain-name"),
  currentSiteTime: $("current-site-time"),
  todayTotal: $("today-total"),
  taskStatus: $("task-status"),
  profileSelect: $("profile-select"),
  sessionDuration: $("session-duration"),
  recommendation: $("recommendation"),
  startBtn: $("start-btn"),
  stopBtn: $("stop-btn"),
  dashboardBtn: $("dashboard-btn"),
  loginBtn: $("login-btn"),
  refreshBtn: $("refresh-btn")
};

let latestSummary = null;

function fmtMinutes(minutes) {
  const numeric = Number(minutes);
  const value = Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
  if (value < 60) {
    return `${value}m`;
  }
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function setFavicon(domain) {
  els.favicon.textContent = domain ? domain.slice(0, 2).toUpperCase() : "";
  els.favicon.style.backgroundImage = "";

  if (!domain) {
    return;
  }

  const image = new Image();
  image.onload = () => {
    els.favicon.textContent = "";
    els.favicon.style.backgroundImage = `url(${image.src})`;
  };
  image.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

function selectedProfile() {
  const profiles = latestSummary?.taskProfiles || [];
  return profiles.find((profile) => profile.id === els.profileSelect.value) || profiles[0] || null;
}

function renderProfiles(summary) {
  const profiles = summary.taskProfiles || [];
  const previousValue = els.profileSelect.value;

  if (!profiles.length) {
    els.profileSelect.innerHTML = '<option value="">No profiles yet</option>';
    els.profileSelect.disabled = true;
    els.startBtn.disabled = true;
    return;
  }

  els.profileSelect.disabled = false;
  els.profileSelect.innerHTML = profiles
    .map((profile) => `<option value="${profile.id}">${profile.name}</option>`)
    .join("");

  const activeProfileId = summary.taskMode?.current?.profileId;
  const nextValue = activeProfileId || previousValue || profiles[0].id;
  if (profiles.some((profile) => profile.id === nextValue)) {
    els.profileSelect.value = nextValue;
  }
}

function recommendationFor(summary) {
  const activeProfile = summary.taskMode?.current;
  if (activeProfile?.qualityScore != null && activeProfile.qualityScore < 70) {
    return "Your focus score is slipping; switch back to an allowed site.";
  }

  if (summary.recommendation && summary.recommendation !== "-") {
    return summary.recommendation;
  }

  const distractingRatio = Number(summary.categoryBreakdown?.distractingRatio || 0);
  if (distractingRatio >= 35) {
    return "Distractions are taking a large share today.";
  }

  if (!summary.domain) {
    return "Open a web tab to start tracking.";
  }

  return "Keep the extension light; review deeper trends in the dashboard.";
}

function render(summary) {
  latestSummary = summary;
  const domain = summary.domain || summary.currentDomain || null;
  const totalToday = summary.totalTodayMinutes ?? Object.values(summary.usage || {}).reduce(
    (sum, minutes) => sum + Number(minutes || 0),
    0
  );

  setFavicon(domain);
  els.domainName.textContent = domain || "No active tab";
  els.currentSiteTime.textContent = domain ? fmtMinutes(summary.todayMinutes) : "-";
  els.todayTotal.textContent = fmtMinutes(totalToday);

  renderProfiles(summary);

  const currentTask = summary.taskMode?.current || null;
  els.taskStatus.textContent = currentTask?.profileName || currentTask?.group || "Off";
  els.taskStatus.classList.toggle("active", Boolean(currentTask));
  els.sessionDuration.textContent = currentTask
    ? fmtMinutes(currentTask.elapsedMinutes || 0)
    : fmtMinutes(summary.currentSessionMinutes || 0);
  els.startBtn.disabled = Boolean(currentTask) || els.profileSelect.disabled;
  els.stopBtn.disabled = !currentTask;
  els.recommendation.textContent = recommendationFor(summary);
}

async function refresh() {
  try {
    const summary = await chrome.runtime.sendMessage({ type: "GET_USAGE_SUMMARY" });
    if (summary) {
      render(summary);
    }

    const auth = await chrome.runtime.sendMessage({ type: "GET_AUTH_STATE" });
    els.loginBtn.textContent = auth?.authEmail ? "Signed in" : "Sign in";
    els.loginBtn.disabled = Boolean(auth?.authEmail);
  } catch (_error) {
    els.recommendation.textContent = "Reload the extension if tracking is unavailable.";
  }
}

els.startBtn.addEventListener("click", async () => {
  const profile = selectedProfile();
  if (!profile) {
    return;
  }

  const taskMode = await chrome.runtime.sendMessage({
    type: "START_TASK_SESSION",
    profileId: profile.id,
    title: profile.name,
    defaultDurationMinutes: profile.defaultDurationMinutes
  });

  render({
    ...latestSummary,
    taskMode
  });
  await refresh();
});

els.stopBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "STOP_TASK_SESSION" });
  await refresh();
});

els.dashboardBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: WEB_DASHBOARD_URL });
});

els.loginBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "START_LOGIN" });
  await refresh();
});

els.refreshBtn.addEventListener("click", refresh);

refresh();
const timer = setInterval(refresh, 1000);
window.addEventListener("pagehide", () => clearInterval(timer));
