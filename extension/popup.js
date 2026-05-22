/* ─────────────────────────────────────────────
   LifeCycle popup.js — redesigned UI renderer
   Reads from chrome.storage.local + background
   and populates the new layout every second.
───────────────────────────────────────────── */

"use strict";

/* ── Helpers ─────────────────────────────── */

function fmt(minutes) {
  if (minutes == null || isNaN(minutes) || minutes === "-") return "—";
  const m = Math.round(Number(minutes));
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? h + "h" : h + "h " + rem + "m";
}

function weekdayName(date) {
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

/* ── DOM refs ────────────────────────────── */

const $ = id => document.getElementById(id);

const domFavicon         = $("favicon");
const domDomainName      = $("domain-name");
const domStatusBadge     = $("status-badge");
const domStatToday       = $("stat-today");
const domStatAvg         = $("stat-avg");
const domStatAvgLbl      = $("stat-avg-lbl");
const domStatPredicted   = $("stat-predicted");
const domSessionSection  = $("session-section");
const domSessionMeta     = $("session-meta");
const domSessionFill     = $("session-fill");
const domSessionCaption  = $("session-caption");
const domRecommendation  = $("recommendation");
const domSitesList       = $("sites-list");
const domConfidence      = $("confidence-row");
const domResetSelect     = $("reset-select");
const domTotalScreenTime = $("total-screen-time");
const domGearBtn         = $("gear-btn");
const domSettingsPanel   = $("settings-panel");
const domLoginBtn        = $("login-btn");
const domSignoutBtn      = $("signout-btn");
const domAuthStatus      = $("auth-status");
const domOnboarding      = $("onboarding");
const domTaskTitle       = $("task-title");
const domTaskDomains     = $("task-domains");
const domTaskBlockedDomains = $("task-blocked-domains");
const domTaskProfileSelect = $("task-profile-select");
const domTaskDuration    = $("task-duration");
const domTaskSuggestion  = $("task-suggestion");
const domTaskStatus      = $("task-status");
const domTaskMetrics     = $("task-metrics");
const domProfileAnalytics = $("profile-analytics");
const domTaskSuggestBtn  = $("task-suggest-btn");
const domTaskSaveProfileBtn = $("task-save-profile-btn");
const domTaskDeleteProfileBtn = $("task-delete-profile-btn");
const domTaskStartBtn    = $("task-start-btn");
const domTaskStopBtn     = $("task-stop-btn");

/* ── Theme ───────────────────────────────── */

const THEMES = ["default", "dark", "forest", "dusk", "sand"];

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = "default";
  document.documentElement.setAttribute("data-theme", theme);
  // sync the radio buttons
  document.querySelectorAll('input[name="theme"]').forEach(radio => {
    radio.checked = radio.value === theme;
  });
}

function loadTheme() {
  chrome.storage.local.get({ uiTheme: "default" }, ({ uiTheme }) => {
    applyTheme(uiTheme);
  });
}

function saveTheme(theme) {
  applyTheme(theme);
  chrome.storage.local.set({ uiTheme: theme });
}

loadTheme();

document.querySelectorAll('input[name="theme"]').forEach(radio => {
  radio.addEventListener("change", () => {
    if (radio.checked) saveTheme(radio.value);
  });
});

/* ── Settings panel toggle ───────────────── */

domGearBtn.addEventListener("click", () => {
  domSettingsPanel.classList.toggle("open");
});

/* ── Reset setting ───────────────────────── */

chrome.storage.local.get({ settings: {} }, ({ settings }) => {
  domResetSelect.value = settings.dailyResetHour === 3 ? "3am" : "midnight";
});

domResetSelect.addEventListener("change", () => {
  const dailyResetHour = domResetSelect.value === "3am" ? 3 : 0;
  chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    settings: { dailyResetHour }
  });
});

/* ── Notification toggle ─────────────────── */

const domNotifToggle   = $("notif-toggle");
const domOverlayToggle = $("overlay-toggle");

chrome.storage.local.get({ alertSettings: { notificationsEnabled: true, overlayEnabled: true } }, ({ alertSettings }) => {
  domNotifToggle.checked   = alertSettings.notificationsEnabled !== false;
  domOverlayToggle.checked = alertSettings.overlayEnabled !== false;
});

function saveAlertSettings() {
  chrome.storage.local.set({
    alertSettings: {
      notificationsEnabled: domNotifToggle.checked,
      overlayEnabled: domOverlayToggle.checked
    }
  });
}

domNotifToggle.addEventListener("change", saveAlertSettings);
domOverlayToggle.addEventListener("change", saveAlertSettings);

async function refreshAuthState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_AUTH_STATE" });
    const signedIn = Boolean(response?.authToken && response?.authEmail);

    domLoginBtn.textContent = signedIn ? response.authEmail : "Sign in";
    domLoginBtn.title = signedIn ? response.authEmail : "Sign in";
    domLoginBtn.classList.toggle("signed-in", signedIn);
    domSignoutBtn.classList.toggle("visible", signedIn);
    domAuthStatus.textContent = response?.authError || "";
  } catch (_error) {
    domLoginBtn.textContent = "Sign in";
    domLoginBtn.classList.remove("signed-in");
    domSignoutBtn.classList.remove("visible");
    domAuthStatus.textContent = "";
  }
}

domLoginBtn.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "GET_AUTH_STATE" });

  if (response?.authToken) {
    return;
  }

  await chrome.runtime.sendMessage({ type: "START_LOGIN" });
});

domSignoutBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "SIGN_OUT" });
  await refreshAuthState();
});

function splitDomainInput(value) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((domain) => domain.trim())
    .filter(Boolean);
}

function selectedProfile(raw) {
  const profileId = domTaskProfileSelect.value;
  if (profileId === "__new__") {
    return null;
  }
  return (raw?.taskProfiles || []).find((profile) => profile.id === profileId) || null;
}

function fillProfile(profile) {
  if (!profile) {
    domTaskTitle.value = "";
    domTaskDomains.value = "";
    domTaskBlockedDomains.value = "";
    domTaskDuration.value = 60;
    domTaskSuggestion.textContent = "New profile";
    return;
  }

  domTaskTitle.value = profile.name;
  domTaskDomains.value = (profile.allowedDomains || []).join("\n");
  domTaskBlockedDomains.value = (profile.blockedDomains || []).join("\n");
  domTaskDuration.value = profile.defaultDurationMinutes || profile.defaultDuration || 60;
  domTaskSuggestion.textContent = `${profile.name}: saved profile`;
}

function renderTaskProfiles(raw) {
  const profiles = raw?.taskProfiles || [];
  const previous = domTaskProfileSelect.value;

  domTaskProfileSelect.innerHTML = [
    ...profiles.map((profile) => `<option value="${profile.id}">${profile.name}</option>`),
    '<option value="__new__">New profile...</option>'
  ].join("");

  if (profiles.some((profile) => profile.id === previous)) {
    domTaskProfileSelect.value = previous;
  }

  if (!previous && profiles[0]) {
    domTaskProfileSelect.value = profiles[0].id;
    fillProfile(profiles[0]);
  }

  const profile = selectedProfile(raw);
  const analytics = profile ? raw?.taskProfileAnalytics?.[profile.id] : null;
  if (!analytics) {
    domProfileAnalytics.textContent = "";
    return;
  }

  const distractions = (analytics.mostDistractingDomains || [])
    .map((item) => `${item.domain} (${item.count})`)
    .join(", ");
  domProfileAnalytics.textContent =
    `${analytics.totalFocusMinutes}m focus · ${analytics.averageSessionQuality ?? "-"} avg score · ` +
    `${analytics.blockedAttempts} blocks · ${analytics.overrideCount} overrides` +
    (distractions ? ` · distractions: ${distractions}` : "");
}

function renderTaskMode(taskMode) {
  const current = taskMode?.current || null;

  if (!current) {
    domTaskStatus.textContent = "Off";
    domTaskStatus.classList.remove("active");
    domTaskMetrics.innerHTML = "";
    domTaskStopBtn.disabled = true;
    domTaskStartBtn.disabled = false;
    return;
  }

  domTaskStatus.textContent = current.group || "Active";
  domTaskStatus.classList.add("active");
  domTaskTitle.value = current.title || domTaskTitle.value;
  domTaskDomains.value = (current.allowedDomains || []).join("\n");
  domTaskBlockedDomains.value = (current.blockedDomains || []).join("\n");
  domTaskDuration.value = current.defaultDurationMinutes || current.defaultDuration || domTaskDuration.value || 60;
  if (current.profileId) {
    domTaskProfileSelect.value = current.profileId;
  }
  domTaskStopBtn.disabled = false;
  domTaskStartBtn.disabled = true;

  const metrics = current.metrics || {};
  const metricItems = [
    ["Score", `${current.qualityScore ?? 100}`],
    ["Allowed", `${current.allowedPercent ?? 100}%`],
    ["Blocked", `${metrics.blockedAttempts || 0}`],
    ["Switches", `${metrics.tabSwitches || 0}`],
    ["Idle", fmt((metrics.idleMs || 0) / 60000)],
    ["Overrides", `${metrics.overrideCount || 0}`]
  ];

  domTaskMetrics.innerHTML = metricItems.map(([label, value]) => `
    <div class="task-metric">
      <div class="task-metric-value">${value}</div>
      <div class="task-metric-label">${label}</div>
    </div>
  `).join("");
}

async function suggestTaskFromInput() {
  const title = domTaskTitle.value.trim();
  const suggestion = await chrome.runtime.sendMessage({
    type: "SUGGEST_TASK",
    title
  });

  if (!suggestion) {
    return;
  }

  domTaskTitle.value = suggestion.title || title;
  domTaskDomains.value = (suggestion.allowedDomains || []).join("\n");
  domTaskBlockedDomains.value = (suggestion.blockedDomains || []).join("\n");
  domTaskDuration.value = suggestion.defaultDurationMinutes || suggestion.defaultDuration || 60;
  domTaskSuggestion.textContent = `${suggestion.group}: ${suggestion.note}`;
}

domTaskSuggestBtn.addEventListener("click", suggestTaskFromInput);
domTaskTitle.addEventListener("change", suggestTaskFromInput);
domTaskProfileSelect.addEventListener("change", async () => {
  const response = await chrome.runtime.sendMessage({ type: "GET_USAGE_SUMMARY" });
  fillProfile(selectedProfile(response));
  renderTaskProfiles(response);
});

domTaskSaveProfileBtn.addEventListener("click", async () => {
  const selectedId = domTaskProfileSelect.value;
  const existingId = selectedId && selectedId !== "__new__" ? selectedId : null;
  const name = domTaskTitle.value.trim() || "Focus";
  const response = await chrome.runtime.sendMessage({
    type: "SAVE_TASK_PROFILE",
    profile: {
      id: existingId,
      name,
      group: name.toLowerCase(),
      allowedDomains: splitDomainInput(domTaskDomains.value),
      blockedDomains: splitDomainInput(domTaskBlockedDomains.value),
      defaultDurationMinutes: Number(domTaskDuration.value || 60)
    }
  });

  if (response?.profiles) {
    domTaskProfileSelect.innerHTML = [
      ...response.profiles.map((profile) => `<option value="${profile.id}">${profile.name}</option>`),
      '<option value="__new__">New profile...</option>'
    ].join("");
    if (response.profile?.id) {
      domTaskProfileSelect.value = response.profile.id;
    }
  }
  domTaskSuggestion.textContent = `${response?.profile?.name || name}: profile saved`;
});

domTaskDeleteProfileBtn.addEventListener("click", async () => {
  const profileId = domTaskProfileSelect.value;
  if (!profileId || profileId === "__new__") {
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "DELETE_TASK_PROFILE",
    profileId
  });
  const profiles = response?.profiles || [];
  domTaskProfileSelect.innerHTML = [
    ...profiles.map((profile) => `<option value="${profile.id}">${profile.name}</option>`),
    '<option value="__new__">New profile...</option>'
  ].join("");
  domTaskProfileSelect.value = profiles[0]?.id || "__new__";
  fillProfile(profiles[0]);
  domTaskSuggestion.textContent = profiles[0] ? "Profile deleted" : "No saved profiles";
});

domTaskStartBtn.addEventListener("click", async () => {
  const title = domTaskTitle.value.trim() || "Focus session";
  const response = await chrome.runtime.sendMessage({
    type: "START_TASK_SESSION",
    profileId: domTaskProfileSelect.value === "__new__" ? null : domTaskProfileSelect.value || null,
    title,
    allowedDomains: splitDomainInput(domTaskDomains.value),
    blockedDomains: splitDomainInput(domTaskBlockedDomains.value),
    defaultDurationMinutes: Number(domTaskDuration.value || 60)
  });
  renderTaskMode(response);
});

domTaskStopBtn.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "STOP_TASK_SESSION" });
  renderTaskMode(response);
});

/* ── Confidence dots ─────────────────────── */

function renderConfidence(label) {
  const filled =
    label === "High confidence" ? 4 :
    label === "Medium confidence" ? 3 :
    label === "Low confidence" ? 2 : 0;

  if (filled === 0) {
    domConfidence.innerHTML = "";
    return;
  }
  let html = '<span style="font-size:10px;color:var(--text-tertiary);margin-right:3px">Confidence</span><span class="conf-dots">';
  for (let i = 0; i < 4; i++) {
    html += `<span class="conf-dot${i < filled ? " filled" : ""}"></span>`;
  }
  html += "</span>";
  domConfidence.innerHTML = html;
}

/* ── Favicon ─────────────────────────────── */

function setFavicon(domain) {
  if (!domain) {
    domFavicon.textContent = "";
    domFavicon.style.background = "var(--bg-hover)";
    return;
  }
  const initials = domain.replace(/^www\./, "").slice(0, 2).toUpperCase();
  domFavicon.textContent = initials;

  const img = document.createElement("img");
  img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  img.onload = () => {
    domFavicon.textContent = "";
    domFavicon.appendChild(img);
  };
}

/* ── Badge ───────────────────────────────── */

function setBadge(text, cls) {
  domStatusBadge.textContent = text || "";
  domStatusBadge.className = "badge " + (cls || "");
}

function setStructuredStatusBadge(statusInfo) {
  if (!statusInfo || statusInfo.label === "-") {
    setBadge("", "muted");
    return;
  }

  if (statusInfo.code === "above" && Number.isFinite(statusInfo.percent)) {
    setBadge(`+${statusInfo.percent}% above avg`, statusInfo.tone || "warn");
    return;
  }

  if (statusInfo.code === "below" && Number.isFinite(statusInfo.percent)) {
    setBadge(`${statusInfo.percent}% below avg`, statusInfo.tone || "ok");
    return;
  }

  if (statusInfo.code === "on_pace" || statusInfo.code === "baseline_ready") {
    setBadge("On pace", statusInfo.tone || "ok");
    return;
  }

  setBadge("", statusInfo.tone || "muted");
}

/* ── Progress bar ────────────────────────── */

function setProgressBar(pct, cls) {
  domSessionFill.style.width = clamp(pct, 0, 100) + "%";
  domSessionFill.className = "progress-fill " + (cls || "muted");
}

/* ── Sites list ──────────────────────────── */

function renderSites(usageToday, activeDomain) {
  if (!usageToday || Object.keys(usageToday).length === 0) {
    domSitesList.innerHTML = '<div class="no-data">No sites tracked today</div>';
    return;
  }

  const sorted = Object.entries(usageToday)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const total = sorted.reduce((s, [, m]) => s + m, 0);
  const topMins = sorted[0][1];

  domSitesList.innerHTML = sorted.map(([domain, mins]) => {
    const isActive = domain === activeDomain;
    const barPct = topMins > 0 ? (mins / topMins) * 100 : 0;
    const pct = total > 0 ? Math.round((mins / total) * 100) : 0;
    const barColor = isActive ? "var(--col-active)" : "var(--col-neutral)";
    return `
      <div class="site-row">
        <span class="site-dot" style="background:${barColor}"></span>
        <span class="site-name${isActive ? " active" : ""}" title="${domain}">${domain}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${barPct.toFixed(1)}%;background:${barColor}"></div>
        </div>
        <span class="site-mins">${fmt(mins)}</span>
        <span class="site-pct">${pct}%</span>
      </div>`;
  }).join("");
}

/* ── Main render ─────────────────────────── */

function render(raw) {
  if (!raw) return;

  const domain = raw.domain || null;
  const usageToday = raw.usage || {};
  const domainMins = domain ? Number(usageToday[domain] || 0) : null;

  /* ── Total screen time ── */
  const totalMins = Object.values(usageToday).reduce((sum, m) => sum + Number(m || 0), 0);
  domTotalScreenTime.textContent = totalMins > 0 ? fmt(totalMins) : "—";
  const baselineCount = Number(raw.baselineRecordCount || 0);
  domOnboarding.textContent =
    totalMins <= 0 || baselineCount < 2
      ? "Keep browsing - your first insights appear after a few days of tracking."
      : "";
  renderTaskProfiles(raw);
  renderTaskMode(raw.taskMode);

  /* ── Top bar ── */
  setFavicon(domain);
  domDomainName.textContent = domain || "No active tab";

  const statusInfo = raw.statusInfo || null;
  const statusStr = raw.status || "";
  if (domain && statusInfo) {
    setStructuredStatusBadge(statusInfo);
  } else if (domain && statusStr && statusStr !== "-") {
    const aboveMatch = statusStr.match(/\+(\d+)%/);
    const belowMatch = statusStr.match(/(-\d+)%|(\d+)% below/);
    if (aboveMatch) {
      setBadge(`+${aboveMatch[1]}% above avg`, "warn");
    } else if (belowMatch) {
      const pct = belowMatch[1] || belowMatch[2];
      setBadge(`${pct}% below avg`, "ok");
    } else if (statusStr.includes("normal pace") || statusStr === "Baseline ready") {
      setBadge("On pace", "ok");
    } else {
      setBadge("", "muted");
    }
  } else if (domain) {
    setBadge("", "muted");
  } else {
    setBadge("", "");
  }

  /* ── Stat grid ── */
  domStatToday.textContent = domain ? fmt(domainMins) : "—";

  const avgMins = Number(raw.averageMinutes);
  if (domain && !isNaN(avgMins) && avgMins > 0) {
    domStatAvg.textContent = fmt(avgMins);
    domStatAvgLbl.textContent = "Avg (" + weekdayName(new Date()) + ")";
  } else {
    domStatAvg.textContent = "—";
    domStatAvgLbl.textContent = "Avg";
  }

  const predStr = raw.prediction || "";
  const predMatch = predStr.match(/~(\d+)/);
  const predictedTotal = typeof raw.predictedTotal === "number" ? raw.predictedTotal : null;
  domStatPredicted.textContent = predictedTotal !== null && Number.isFinite(predictedTotal)
    ? "~" + fmt(predictedTotal)
    : predMatch ? "~" + fmt(Number(predMatch[1])) : "—";

  /* ── Session bar ── */
  const curRaw = raw.currentSessionMinutes;
  const typRaw = raw.typicalSessionMinutes;
  const curNum = (curRaw != null && curRaw !== "-") ? Number(curRaw) : null;
  const typNum = (typRaw != null && typRaw !== "-") ? Number(typRaw) : null;

  if (domain && curNum != null) {
    domSessionSection.style.display = "";
    domSessionMeta.textContent = typNum != null
      ? fmt(curNum) + " · typical " + fmt(typNum)
      : fmt(curNum);

    if (raw.sessionStatus === "Paused") {
      domSessionCaption.textContent = "Paused — idle";
      setProgressBar(typNum != null ? (curNum / typNum) * 100 : 50, "muted");
    } else if (typNum != null && typNum > 0) {
      const ratio = curNum / typNum;
      const cls = ratio > 1.3 ? "danger" : ratio > 1 ? "warn" : "ok";
      setProgressBar(Math.min(ratio * 100, 100), cls);
      const pctile = raw.sessionPercentile;
      domSessionCaption.textContent = pctile != null
        ? `Longer than ${pctile}% of your past sessions`
        : "";
    } else {
      setProgressBar(50, "muted");
      domSessionCaption.textContent = "Not enough history yet";
    }
  } else if (!domain) {
    domSessionSection.style.display = "none";
  } else {
    domSessionSection.style.display = "";
    domSessionMeta.textContent = "—";
    setProgressBar(0, "muted");
    domSessionCaption.textContent = "";
  }

  /* ── Recommendation ── */
  domRecommendation.textContent =
    (domain && raw.recommendation && raw.recommendation !== "-")
      ? raw.recommendation
      : "";

  /* ── Sites ── */
  renderSites(usageToday, domain);

  /* ── Confidence ── */
  renderConfidence(raw.baselineConfidence || null);
}

/* ── Poll background every second ───────── */

async function refresh() {
  if (typeof chrome === "undefined" || !chrome.runtime?.id) {
    stopRefresh();
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_USAGE_SUMMARY" });
    if (response) render(response);
    await refreshAuthState();
  } catch (e) {
    if (!chrome.runtime?.id || String(e?.message || "").includes("Extension context invalidated")) {
      stopRefresh();
    }
  }
}

let refreshTimer = null;

function stopRefresh() {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

refresh();
refreshTimer = setInterval(refresh, 1000);
window.addEventListener("pagehide", stopRefresh);
window.addEventListener("unload", stopRefresh);
