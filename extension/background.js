console.log("LifeCycle background loaded");
const BACKEND_URL = "http://127.0.0.1:8000";
const BASELINE_WEEKDAY_OCCURRENCES = 8;
const FULL_DAY_MINUTES = 24 * 60;
const ABOVE_BASELINE_THRESHOLD = 0.3;
const SESSION_HISTORY_LIMIT = 500;
const IDLE_DETECTION_SECONDS = 60;
const MIN_BASELINE_RECORDS = 2;
const MIN_SESSION_HISTORY = 2;
const MIN_TRACKED_DAY_MINUTES_FOR_PREDICTION = 30;
const MIN_DOMAIN_MINUTES_FOR_PREDICTION = 10;
const DAILY_HISTORY_RETENTION_DAYS = 70;
const SESSION_GAP_THRESHOLD_MS = 5 * 60 * 1000;
const SESSION_END_REASONS = new Set([
  "tab_change",
  "idle",
  "window_blur",
  "manual_pause"
]);
const DEFAULT_DOMAIN_CATEGORIES = {
  "chatgpt.com": "productive",
  "github.com": "productive",
  "docs.google.com": "productive",
  "youtube.com": "distracting",
  "reddit.com": "distracting",
  "instagram.com": "distracting",
  "gmail.com": "neutral"
};
const CATEGORY_KEYS = ["productive", "distracting", "neutral"];

let operationQueue = Promise.resolve();

function enqueue(task) {
  operationQueue = operationQueue.then(task, task).catch((error) => {
    console.error("LifeCycle background task failed", error);
  });
  return operationQueue;
}

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get({ settings: {} });
  return {
    dailyResetHour: settings.dailyResetHour === 3 ? 3 : 0
  };
}

async function setSettings(settings) {
  await chrome.storage.local.set({ settings });
}

function normalizeStoredList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

async function getAppState() {
  const {
    activeSession = null,
    currentUsage = null,
    trackingPaused = false,
    excludedDomains = [],
    domainCategories = {}
  } = await chrome.storage.local.get({
    activeSession: null,
    currentUsage: null,
    trackingPaused: false,
    excludedDomains: [],
    domainCategories: {}
  });

  return {
    activeSession,
    currentUsage,
    trackingPaused: Boolean(trackingPaused),
    excludedDomains: normalizeStoredList(excludedDomains),
    domainCategories: domainCategories && typeof domainCategories === "object" ? domainCategories : {}
  };
}

function normalizeCategory(category) {
  return CATEGORY_KEYS.includes(category) ? category : "neutral";
}

function categoryForDomain(domain, domainCategories = {}) {
  if (!domain) {
    return "neutral";
  }

  return normalizeCategory(domainCategories[domain] || DEFAULT_DOMAIN_CATEGORIES[domain]);
}

function isExcludedDomain(domain, excludedDomains = []) {
  return Boolean(domain && excludedDomains.includes(domain));
}

function lifecycleDate(timestamp = Date.now(), resetHour = 0) {
  const date = new Date(timestamp);
  date.setHours(date.getHours() - resetHour);
  return date;
}

function localDateKey(timestamp = Date.now(), resetHour = 0) {
  const date = lifecycleDate(timestamp, resetHour);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousSameWeekdayDateKeys(dateKey, count, resetHour = 0) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day, resetHour, 0, 0, 0);
  const keys = [];

  for (let index = 1; index <= count; index += 1) {
    const previous = new Date(date);
    previous.setDate(date.getDate() - index * 7);
    keys.push(localDateKey(previous.getTime(), resetHour));
  }

  return keys;
}

function minutesSinceReset(timestamp = Date.now(), resetHour = 0) {
  const date = new Date(timestamp);
  const reset = new Date(date);
  reset.setHours(resetHour, 0, 0, 0);

  if (date < reset) {
    reset.setDate(reset.getDate() - 1);
  }

  return Math.max(0, (timestamp - reset.getTime()) / 60000);
}

function nextLocalReset(timestamp, resetHour = 0) {
  const date = new Date(timestamp);
  date.setHours(resetHour, 0, 0, 0);

  if (date.getTime() <= timestamp) {
    date.setDate(date.getDate() + 1);
  }

  return date.getTime();
}

function normalizeDomain(url) {
  let parsedUrl;
  let hostname;

  try {
    parsedUrl = new URL(url);
  } catch (_error) {
    return null;
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return null;
  }

  hostname = parsedUrl.hostname.toLowerCase();

  if (!hostname || hostname === "newtab" || hostname.endsWith(".local")) {
    return null;
  }

  if (hostname.startsWith("www.")) {
    hostname = hostname.slice(4);
  }

  const productHosts = new Map([
    ["docs.google.com", "docs.google.com"],
    ["mail.google.com", "gmail.com"]
  ]);

  if (productHosts.has(hostname)) {
    return productHosts.get(hostname);
  }

  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) {
    return hostname;
  }

  const twoPartTlds = new Set([
    "co.uk",
    "com.au",
    "net.au",
    "org.au",
    "co.nz",
    "com.br",
    "co.jp",
    "co.in"
  ]);
  const finalTwo = parts.slice(-2).join(".");

  if (twoPartTlds.has(finalTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
}

function roundMinutes(value) {
  return Math.round(value * 100) / 100;
}

function displayMinutes(value) {
  return Math.round(value);
}

function displayDomain(domain) {
  if (!domain) {
    return "this site";
  }

  return domain
    .split(".")[0]
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function toIsoString(timestamp) {
  return new Date(timestamp).toISOString();
}

function dateFromDateKey(dateKey, resetHour = 0) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Date(year, month - 1, day, resetHour, 0, 0, 0);
}

function recentDateKeys(dateKey, count, resetHour = 0) {
  const endDate = dateFromDateKey(dateKey, resetHour);
  const keys = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(endDate);
    date.setDate(endDate.getDate() - index);
    keys.push(localDateKey(date.getTime(), resetHour));
  }

  return keys;
}

function sessionStartedAt(session) {
  const value = session?.startedAt || session?.startTime;
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isNaN(timestamp) ? null : timestamp;
}

function sessionEndedAt(session) {
  const value = session?.endedAt || session?.endTime;
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isNaN(timestamp) ? null : timestamp;
}

function sessionDateKey(session, resetHour = 0) {
  const endedAt = sessionEndedAt(session) || sessionStartedAt(session);
  return endedAt ? localDateKey(endedAt, resetHour) : null;
}

function sessionLastSeenAt(session) {
  return session?.lastSeenAt || session?.lastCheckpointAt || session?.startedAt || null;
}

function sessionGapElapsed(session, timestamp) {
  const lastSeenAt = sessionLastSeenAt(session);
  return !lastSeenAt || timestamp - lastSeenAt >= SESSION_GAP_THRESHOLD_MS;
}

function predictionForDay(currentUsage, elapsedMinutesToday) {
  if (elapsedMinutesToday <= 0) {
    return null;
  }

  return (currentUsage / elapsedMinutesToday) * FULL_DAY_MINUTES;
}

function confidenceLabel(dataPoints) {
  if (dataPoints >= 6) {
    return "High confidence";
  }

  if (dataPoints >= 3) {
    return "Medium confidence";
  }

  if (dataPoints >= 1) {
    return "Low confidence";
  }

  return "-";
}

function statusText(predictedTotal, baseline) {
  if (baseline <= 0) {
    return predictedTotal > 0 ? "New activity today" : "No usage yet";
  }

  const delta = (predictedTotal - baseline) / baseline;
  const percent = Math.round(delta * 100);

  if (percent > 0) {
    return `+${percent}% above normal`;
  }

  if (percent < 0) {
    return `${percent}% below normal`;
  }

  return "On your normal pace";
}

function predictionInsight(today, baseline, baselineCount, trackedToday, elapsedMinutesToday, timestamp) {
  if (baselineCount < MIN_BASELINE_RECORDS) {
    return {
      averageMinutes: "-",
      status: "-",
      prediction: "-",
      recommendation: "",
      predictedTotal: null
    };
  }

  if (trackedToday < MIN_TRACKED_DAY_MINUTES_FOR_PREDICTION && today < MIN_DOMAIN_MINUTES_FOR_PREDICTION) {
    const hour = new Date(timestamp).getHours();
    return {
      averageMinutes: displayMinutes(baseline),
      status: "Baseline ready",
      prediction: hour < 10 ? "Early in day" : "-",
      recommendation: "",
      predictedTotal: null
    };
  }

  const predictedTotal = predictionForDay(today, elapsedMinutesToday);
  if (predictedTotal === null) {
    return {
      averageMinutes: displayMinutes(baseline),
      status: "Baseline ready",
      prediction: "-",
      recommendation: "",
      predictedTotal: null
    };
  }

  const hour = new Date(timestamp).getHours();
  const predictionPrefix = hour < 10 ? "Early estimate" : "Prediction";

  return {
    averageMinutes: displayMinutes(baseline),
    status: statusText(predictedTotal, baseline),
    prediction: `${predictionPrefix}: ~${displayMinutes(predictedTotal)} min today`,
    recommendation: recommendationText(today, baseline, predictedTotal),
    predictedTotal
  };
}

function recommendationText(today, baseline, predictedTotal) {
  if (baseline <= 0) {
    return today > 0
      ? "No same-weekday baseline yet - keep tracking to make this meaningful"
      : "No usage recorded for this site today";
  }

  if (predictedTotal > baseline * (1 + ABOVE_BASELINE_THRESHOLD)) {
    if (today >= baseline) {
      return "You've passed your usual full-day usage for this site";
    }

    return "Stopping now keeps you within your normal range";
  }

  if (predictedTotal <= baseline) {
    return "Stopping now keeps you within your normal range";
  }

  return "You're above normal pace, but still inside the 30% range";
}

function median(values) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }

  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function percentileLongerThan(currentMinutes, previousDurations) {
  if (previousDurations.length === 0) {
    return null;
  }

  const shorterCount = previousDurations.filter((duration) => currentMinutes > duration).length;
  return Math.round((shorterCount / previousDurations.length) * 100);
}

function sessionStatusText(currentMinutes, typicalMinutes) {
  if (currentMinutes <= 0) {
    return "No active session";
  }

  if (typicalMinutes <= 0) {
    return "Active";
  }

  if (currentMinutes > typicalMinutes) {
    return "Above typical";
  }

  return "Within typical session";
}

function sessionRecommendationText(currentMinutes, typicalMinutes, percentile, domain) {
  if (currentMinutes <= 0) {
    return "";
  }

  if (typicalMinutes <= 0) {
    return "";
  }

  if (currentMinutes > typicalMinutes) {
    if (percentile !== null) {
      return `This session is already longer than ${percentile}% of your past ${displayDomain(domain)} sessions`;
    }

    return "Stop now if this was meant to be a quick check";
  }

  return "You're still within your typical session length";
}

async function getDailyUsage() {
  const { dailyUsage = {}, trackedDays = {} } = await chrome.storage.local.get({
    dailyUsage: {},
    trackedDays: {}
  });
  return { dailyUsage, trackedDays };
}

async function setDailyUsage(dailyUsage, trackedDays) {
  await chrome.storage.local.set({ dailyUsage, trackedDays });
}

function pruneDailyHistory(dailyUsage, trackedDays, timestamp = Date.now(), resetHour = 0) {
  const cutoffDate = lifecycleDate(timestamp, resetHour);
  cutoffDate.setDate(cutoffDate.getDate() - DAILY_HISTORY_RETENTION_DAYS);
  const cutoffKey = localDateKey(cutoffDate.getTime(), 0);

  for (const dateKey of Object.keys(dailyUsage)) {
    if (dateKey < cutoffKey) {
      delete dailyUsage[dateKey];
    }
  }

  for (const dateKey of Object.keys(trackedDays)) {
    if (dateKey < cutoffKey) {
      delete trackedDays[dateKey];
    }
  }
}

async function getSessions() {
  const { sessions = [] } = await chrome.storage.local.get({ sessions: [] });
  return Array.isArray(sessions) ? sessions : [];
}

async function saveCompletedSession(activeSession, endedAt, reasonEnded = "tab_change") {
  const startedAt = activeSession.startedAt || activeSession.lastCheckpointAt;

  if (!activeSession.domain || !startedAt || endedAt <= startedAt) {
    return;
  }

  const durationMinutes = roundMinutes((endedAt - startedAt) / 60000);

  if (durationMinutes <= 0) {
    return;
  }

  const sessions = await getSessions();
  const safeReason = SESSION_END_REASONS.has(reasonEnded) ? reasonEnded : "tab_change";
  sessions.push({
    domain: activeSession.domain,
    startedAt: toIsoString(startedAt),
    endedAt: toIsoString(endedAt),
    durationMinutes,
    reasonEnded: safeReason
  });

  await chrome.storage.local.set({
    sessions: sessions.slice(-SESSION_HISTORY_LIMIT)
  });
}

async function saveCompletedSessionIfGapElapsed(activeSession, timestamp, reasonEnded = "tab_change") {
  if (!activeSession?.domain || !sessionGapElapsed(activeSession, timestamp)) {
    return false;
  }

  const endedAt = sessionLastSeenAt(activeSession) || timestamp;
  await saveCompletedSession(activeSession, endedAt, reasonEnded);
  return true;
}

async function addUsageMinutes(domain, startedAt, endedAt) {
  if (!domain || endedAt <= startedAt) {
    return;
  }

  const settings = await getSettings();
  const { dailyUsage, trackedDays } = await getDailyUsage();
  let cursor = startedAt;

  while (cursor < endedAt) {
    const boundary = Math.min(nextLocalReset(cursor, settings.dailyResetHour), endedAt);
    const dateKey = localDateKey(cursor, settings.dailyResetHour);
    const minutes = (boundary - cursor) / 60000;

    trackedDays[dateKey] = true;

    if (!dailyUsage[dateKey]) {
      dailyUsage[dateKey] = {};
    }

    dailyUsage[dateKey][domain] = roundMinutes((dailyUsage[dateKey][domain] || 0) + minutes);
    cursor = boundary;
  }

  pruneDailyHistory(dailyUsage, trackedDays, endedAt, settings.dailyResetHour);
  await setDailyUsage(dailyUsage, trackedDays);
}

async function checkpointCurrentUsage(timestamp = Date.now(), options = {}) {
  const { currentUsage = null } = await chrome.storage.local.get({ currentUsage: null });

  if (!currentUsage?.domain) {
    return;
  }

  const checkpointAt = currentUsage.lastCheckpointAt || currentUsage.startedAt || timestamp;
  const endedAt = Math.max(checkpointAt, timestamp - (options.subtractIdleSeconds || 0) * 1000);

  if (endedAt > checkpointAt) {
    await addUsageMinutes(currentUsage.domain, checkpointAt, endedAt);
  }

  if (options.clear) {
    await chrome.storage.local.remove("currentUsage");
    return;
  }

  await chrome.storage.local.set({
    currentUsage: {
      ...currentUsage,
      lastCheckpointAt: endedAt,
      date: localDateKey(endedAt, (await getSettings()).dailyResetHour)
    }
  });
}

async function updateCurrentUsage(domain, tab, timestamp = Date.now()) {
  const settings = await getSettings();
  const { currentUsage = null } = await chrome.storage.local.get({ currentUsage: null });

  if (!domain) {
    await checkpointCurrentUsage(timestamp, { clear: true });
    return;
  }

  if (currentUsage?.domain && currentUsage.domain !== domain) {
    await checkpointCurrentUsage(timestamp, { clear: true });
  } else if (currentUsage?.domain === domain) {
    await checkpointCurrentUsage(timestamp);
  }

  const { currentUsage: refreshedUsage = null } = await chrome.storage.local.get({ currentUsage: null });

  if (refreshedUsage?.domain === domain) {
    await chrome.storage.local.set({
      currentUsage: {
        ...refreshedUsage,
        tabId: tab?.id,
        windowId: tab?.windowId,
        date: localDateKey(timestamp, settings.dailyResetHour)
      }
    });
    return;
  }

  await chrome.storage.local.set({
    currentUsage: {
      domain,
      tabId: tab?.id,
      windowId: tab?.windowId,
      startedAt: timestamp,
      lastCheckpointAt: timestamp,
      date: localDateKey(timestamp, settings.dailyResetHour)
    }
  });
}

async function checkpointActiveSession(timestamp = Date.now()) {
  await checkpointCurrentUsage(timestamp);
}

async function getFocusSnapshot() {
  // Include popup window type so we can detect when the extension popup is
  // the focused window and avoid misidentifying it as a lost-focus event.
  const windows = await chrome.windows.getAll({ windowTypes: ["normal", "popup"] });
  const focusedWindow = windows.find((w) => w.focused) || null;

  // If the focused window is the extension popup itself, treat it as
  // transparent — find the most-recently-focused normal browser window
  // instead, so we don't end the active session just because the user
  // opened the popup.
  const isExtensionPopup =
    focusedWindow?.type === "popup" &&
    focusedWindow?.id !== chrome.windows.WINDOW_ID_NONE;

  let trackingWindow = focusedWindow;
  if (isExtensionPopup) {
    const normalWindows = windows.filter((w) => w.type === "normal");
    // Fall back to the last normal window; Chrome orders by recency descending.
    trackingWindow = normalWindows[0] || null;
  }

  let activeTab = null;
  if (trackingWindow) {
    const [tab] = await chrome.tabs.query({
      active: true,
      windowId: trackingWindow.id
    });
    activeTab = tab || null;
  }

  return {
    // Expose whether the popup is currently open — useful for callers.
    isExtensionPopupFocused: isExtensionPopup,
    focusedWindow: trackingWindow,
    activeTab,
    currentDomain: activeTab?.url ? normalizeDomain(activeTab.url) : null
  };
}

async function getFocusedActiveTab() {
  return (await getFocusSnapshot()).activeTab;
}

async function pauseTrackingForIdle(timestamp = Date.now(), subtractIdleSeconds = 0, reasonEnded = "idle") {
  const {
    activeSession = null,
    currentUsage = null
  } = await chrome.storage.local.get({
    activeSession: null,
    currentUsage: null
  });

  await checkpointCurrentUsage(timestamp, {
    subtractIdleSeconds,
    clear: true
  });

  if (!activeSession?.domain) {
    return;
  }

  const currentEndedAt = Math.max(
    sessionLastSeenAt(activeSession) || timestamp,
    timestamp - subtractIdleSeconds * 1000
  );
  const pausedSession =
    currentUsage?.domain === activeSession.domain
      ? {
          ...activeSession,
          lastCheckpointAt: currentEndedAt,
          lastSeenAt: currentEndedAt,
          date: localDateKey(currentEndedAt, (await getSettings()).dailyResetHour)
        }
      : activeSession;

  if (await saveCompletedSessionIfGapElapsed(pausedSession, timestamp, reasonEnded)) {
    await chrome.storage.local.remove("activeSession");
    return;
  }

  await chrome.storage.local.set({ activeSession: pausedSession });
}

async function resumeTrackingIfActive() {
  const idleState = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);

  if (idleState === "active") {
    await refreshActiveContext();
  }
}

async function startSessionForTab(tab, timestamp = Date.now()) {
  const domain = tab?.url ? normalizeDomain(tab.url) : null;
  console.log("Starting session for:", domain);
  const { activeSession, currentUsage, trackingPaused, excludedDomains } = await getAppState();
  const settings = await getSettings();

  if (!domain) {
    await updateCurrentUsage(null, null, timestamp);
    return;
  }

  if (trackingPaused || isExcludedDomain(domain, excludedDomains)) {
    await updateCurrentUsage(null, null, timestamp);

    if (
      activeSession?.domain &&
      await saveCompletedSessionIfGapElapsed(activeSession, timestamp, "manual_pause")
    ) {
      await chrome.storage.local.remove("activeSession");
    }

    return;
  }

  let sessionState = activeSession;

  if (
    activeSession?.domain &&
    activeSession.domain !== domain &&
    currentUsage?.domain === activeSession.domain
  ) {
    sessionState = {
      ...activeSession,
      lastCheckpointAt: timestamp,
      lastSeenAt: timestamp,
      date: localDateKey(timestamp, settings.dailyResetHour)
    };
  }

  await updateCurrentUsage(domain, tab, timestamp);
  const { currentUsage: updatedUsage = null } = await chrome.storage.local.get({ currentUsage: null });
  const sessionStartedAt = updatedUsage?.domain === domain
    ? updatedUsage.startedAt || timestamp
    : timestamp;

  if (!sessionState?.domain) {
    await chrome.storage.local.set({
      activeSession: {
        domain,
        tabId: tab.id,
        windowId: tab.windowId,
        startedAt: sessionStartedAt,
        lastCheckpointAt: timestamp,
        lastSeenAt: timestamp,
        date: localDateKey(timestamp, settings.dailyResetHour)
      }
    });
    return;
  }

  if (sessionState?.domain === domain) {
    if (sessionGapElapsed(sessionState, timestamp)) {
      await saveCompletedSessionIfGapElapsed(sessionState, timestamp, "tab_change");
      await chrome.storage.local.set({
        activeSession: {
          domain,
          tabId: tab.id,
          windowId: tab.windowId,
          startedAt: sessionStartedAt,
          lastCheckpointAt: timestamp,
          lastSeenAt: timestamp,
          date: localDateKey(timestamp, settings.dailyResetHour)
        }
      });
      return;
    }

    await chrome.storage.local.set({
      activeSession: {
        ...sessionState,
        tabId: tab.id,
        windowId: tab.windowId,
        lastSeenAt: timestamp,
        lastCheckpointAt: timestamp,
        date: localDateKey(timestamp, settings.dailyResetHour)
      }
    });
    return;
  }

  if (sessionGapElapsed(sessionState, timestamp)) {
    await saveCompletedSessionIfGapElapsed(sessionState, timestamp, "tab_change");

    await chrome.storage.local.set({
      activeSession: {
        domain,
        tabId: tab.id,
        windowId: tab.windowId,
        startedAt: sessionStartedAt,
        lastCheckpointAt: timestamp,
        lastSeenAt: timestamp,
        date: localDateKey(timestamp, settings.dailyResetHour)
      }
    });
    return;
  }

  if (sessionState !== activeSession) {
    await chrome.storage.local.set({ activeSession: sessionState });
  }
}

async function getCurrentTrackedDomain() {
  const activeTab = await getFocusedActiveTab();
  return activeTab?.url ? normalizeDomain(activeTab.url) : null;
}

async function refreshActiveContext() {
  const timestamp = Date.now();
  const idleState = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);
  const { trackingPaused, excludedDomains } = await getAppState();
  const { isExtensionPopupFocused, focusedWindow, activeTab, currentDomain: newDomain } = await getFocusSnapshot();

  // The user opened the extension popup. This is not a real focus change —
  // the underlying browser tab is still active. Skip this cycle entirely so
  // we don't end the session or clear currentUsage.
  if (isExtensionPopupFocused) {
    await updateBadge();
    return;
  }

  if (trackingPaused) {
    await updateCurrentUsage(null, null, timestamp);
    await updateBadge();
    return;
  }

  if (idleState !== "active") {
    await pauseTrackingForIdle(timestamp, IDLE_DETECTION_SECONDS, "idle");
    await updateBadge();
    return;
  }

  console.log("Active tab:", activeTab?.url);
  await checkpointActiveSession(timestamp, { currentDomain: newDomain });
  let { activeSession = null } = await chrome.storage.local.get({ activeSession: null });

  if (!focusedWindow) {
    await pauseTrackingForIdle(timestamp, 0, "window_blur");
    await updateBadge();
    await syncTodayToBackend();
    return;
  }

  if (!newDomain) {
    await pauseTrackingForIdle(timestamp, 0, "tab_change");
    await updateBadge();
    await syncTodayToBackend();
    return;
  }

  if (isExcludedDomain(newDomain, excludedDomains)) {
    await pauseTrackingForIdle(timestamp, 0, "manual_pause");
    await updateBadge();
    await syncTodayToBackend();
    return;
  }

  console.log("NEW DOMAIN:", newDomain);
  console.log("OLD DOMAIN:", activeSession?.domain);

  await startSessionForTab(activeTab, timestamp);
  await updateBadge();
  await syncTodayToBackend();

  // ── Alerts: notifications + in-page overlay ───────────────────────────────
  try {
    const coreSettings = await getSettings();
    const alertDateKey = localDateKey(timestamp, coreSettings.dailyResetHour);
    const { dailyUsage: alertUsage, trackedDays: alertTracked } = await getDailyUsage();
    const alertUsageToday = alertUsage[alertDateKey] || {};
    const alertDomainMins = newDomain ? Number(alertUsageToday[newDomain] || 0) : 0;
    const { baseline: alertBaseline, recordCount: alertCount } = baselineForDomain(
      alertUsage, alertTracked, alertDateKey, newDomain,
      BASELINE_WEEKDAY_OCCURRENCES, coreSettings.dailyResetHour
    );
    const alertAvg = alertCount >= MIN_BASELINE_RECORDS ? alertBaseline : 0;
    const alertSession = await buildCurrentSessionInsight(newDomain, timestamp);

    const { alertSettings: userAlertSettings = {} } = await chrome.storage.local.get({ alertSettings: {} });
    const notifEnabled   = userAlertSettings.notificationsEnabled !== false;
    const overlayEnabled = userAlertSettings.overlayEnabled !== false;

    if (notifEnabled) {
      await maybeNotify(newDomain, alertDomainMins, alertAvg, null);
    }
    if (overlayEnabled && activeTab?.id) {
      await updateOverlay(
        activeTab.id, newDomain, alertDomainMins, alertAvg,
        alertSession.currentSessionMinutes,
        alertSession.typicalSessionMinutes
      );
    }
  } catch (_alertErr) {
    // Alerts are non-critical — never break core tracking
  }
}

function totalMinutesForDate(dailyUsage, dateKey) {
  return Object.values(dailyUsage[dateKey] || {}).reduce((sum, minutes) => sum + Number(minutes || 0), 0);
}

function baselineForDomain(
  dailyUsage,
  trackedDays,
  dateKey,
  domain,
  occurrences = BASELINE_WEEKDAY_OCCURRENCES,
  resetHour = 0
) {
  if (!domain) {
    return { baseline: 0, recordCount: 0 };
  }

  const dates = previousSameWeekdayDateKeys(dateKey, occurrences, resetHour);
  const recordedDates = dates.filter((previousDate) => trackedDays[previousDate]);
  const total = recordedDates.reduce((sum, previousDate) => {
    return sum + Number(dailyUsage[previousDate]?.[domain] ?? 0);
  }, 0);

  return {
    baseline: recordedDates.length > 0 ? total / recordedDates.length : 0,
    recordCount: recordedDates.length
  };
}

async function buildCurrentSessionInsight(domain, timestamp = Date.now()) {
  const { activeSession, trackingPaused, excludedDomains } = await getAppState();
  const idleState = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);

  if (trackingPaused) {
    return {
      currentSessionMinutes: "-",
      typicalSessionMinutes: "-",
      sessionStatus: "Paused",
      sessionConfidence: "-",
      sessionPercentile: null,
      sessionPercentileText: "-",
      sessionRecommendation: ""
    };
  }

  if (isExcludedDomain(domain, excludedDomains)) {
    return {
      currentSessionMinutes: "-",
      typicalSessionMinutes: "-",
      sessionStatus: "Excluded",
      sessionConfidence: "-",
      sessionPercentile: null,
      sessionPercentileText: "-",
      sessionRecommendation: ""
    };
  }

  // Match against activeSession.domain directly; domain param is the resolved current domain
  const sessionDomain = activeSession?.domain || null;
  const isTracking = sessionDomain && sessionDomain === domain;

  if (!isTracking) {
    return {
      currentSessionMinutes: "-",
      typicalSessionMinutes: "-",
      sessionStatus: domain && idleState !== "active" ? "Paused" : "No active tab",
      sessionConfidence: "-",
      sessionPercentile: null,
      sessionPercentileText: "-",
      sessionRecommendation: ""
    };
  }

  // Use startedAt so checkpoints do not reset the visible session duration
  const sessionStart = activeSession.startedAt || activeSession.lastCheckpointAt || timestamp;
  const currentSessionMinutes = Math.max(0, (timestamp - sessionStart) / 60000);
  const sessions = await getSessions();
  const previousDurations = sessions
    .filter((session) => session.domain === domain)
    .map((session) => Number(session.durationMinutes || 0))
    .filter((duration) => duration > 0);
  const typicalSessionMinutes = median(previousDurations);
  const percentile = percentileLongerThan(currentSessionMinutes, previousDurations);
  const sessionConfidence = confidenceLabel(previousDurations.length);

  if (previousDurations.length < MIN_SESSION_HISTORY) {
    return {
      currentSessionMinutes: displayMinutes(currentSessionMinutes),
      typicalSessionMinutes: "-",
      sessionStatus: "Active",
      sessionConfidence: "-",
      sessionPercentile: percentile,
      sessionPercentileText: "-",
      sessionRecommendation: ""
    };
  }

  return {
    currentSessionMinutes: displayMinutes(currentSessionMinutes),
    typicalSessionMinutes: displayMinutes(typicalSessionMinutes),
    sessionStatus: sessionStatusText(currentSessionMinutes, typicalSessionMinutes),
    sessionConfidence,
    sessionPercentile: percentile,
    sessionPercentileText:
      percentile === null
        ? "-"
        : `Longer than ${percentile}% of previous ${domain} sessions`,
    sessionRecommendation: sessionRecommendationText(currentSessionMinutes, typicalSessionMinutes, percentile, domain)
  };
}

function categoryTotalsForUsage(usage = {}, domainCategories = {}) {
  const totals = {
    productive: 0,
    distracting: 0,
    neutral: 0,
    total: 0
  };

  for (const [domain, minutes] of Object.entries(usage)) {
    const value = Number(minutes || 0);
    const category = categoryForDomain(domain, domainCategories);
    totals[category] += value;
    totals.total += value;
  }

  return {
    productive: displayMinutes(totals.productive),
    distracting: displayMinutes(totals.distracting),
    neutral: displayMinutes(totals.neutral),
    total: displayMinutes(totals.total),
    productiveRatio:
      totals.total > 0 ? Math.round((totals.productive / totals.total) * 100) : 0,
    distractingRatio:
      totals.total > 0 ? Math.round((totals.distracting / totals.total) * 100) : 0
  };
}

function aggregateUsageForDates(dailyUsage, dateKeys) {
  const aggregate = {};

  for (const dateKey of dateKeys) {
    for (const [domain, minutes] of Object.entries(dailyUsage[dateKey] || {})) {
      aggregate[domain] = roundMinutes((aggregate[domain] || 0) + Number(minutes || 0));
    }
  }

  return aggregate;
}

function topUsageEntries(usage = {}, limit = 3) {
  return Object.entries(usage)
    .map(([domain, minutes]) => ({ domain, minutes: displayMinutes(minutes) }))
    .filter((entry) => entry.minutes > 0)
    .sort((left, right) => right.minutes - left.minutes)
    .slice(0, limit);
}

function topDomainForCategory(usage = {}, domainCategories = {}, category) {
  return Object.entries(usage)
    .map(([domain, minutes]) => ({
      domain,
      minutes: Number(minutes || 0),
      category: categoryForDomain(domain, domainCategories)
    }))
    .filter((entry) => entry.category === category && entry.minutes > 0)
    .sort((left, right) => right.minutes - left.minutes)[0] || null;
}

function sessionsForDate(sessions, dateKey, resetHour = 0) {
  return sessions.filter((session) => sessionDateKey(session, resetHour) === dateKey);
}

function sessionsForDates(sessions, dateKeys, resetHour = 0) {
  const keySet = new Set(dateKeys);
  return sessions.filter((session) => keySet.has(sessionDateKey(session, resetHour)));
}

function contextSwitchCount(sessions) {
  return sessions.filter((session) => session.reasonEnded === "tab_change").length;
}

function bestFocusBlock(sessions, activeSession, domainCategories, dateKey, resetHour, timestamp) {
  const todaySessions = sessionsForDate(sessions, dateKey, resetHour)
    .map((session) => ({
      domain: session.domain,
      durationMinutes: Number(session.durationMinutes || 0)
    }));

  if (
    activeSession?.domain &&
    categoryForDomain(activeSession.domain, domainCategories) === "productive"
  ) {
    const sessionStart = activeSession.startedAt || activeSession.lastCheckpointAt || timestamp;
    todaySessions.push({
      domain: activeSession.domain,
      durationMinutes: Math.max(0, (timestamp - sessionStart) / 60000)
    });
  }

  return todaySessions
    .filter((session) => categoryForDomain(session.domain, domainCategories) === "productive")
    .sort((left, right) => right.durationMinutes - left.durationMinutes)[0] || null;
}

function buildInsightList({
  domain,
  today,
  baseline,
  baselineRecordCount,
  currentSessionMinutes,
  typicalSessionMinutes,
  usageToday,
  sessions,
  activeSession,
  domainCategories,
  dateKey,
  resetHour,
  timestamp
}) {
  const insights = [];

  if (domain && baselineRecordCount >= MIN_BASELINE_RECORDS && baseline > 0) {
    const delta = (today - baseline) / baseline;

    if (delta >= 0.1) {
      insights.push(
        `You've spent ${Math.round(delta * 100)}% more time on ${domain} than usual today`
      );
    }
  }

  if (
    domain &&
    typeof currentSessionMinutes === "number" &&
    typeof typicalSessionMinutes === "number" &&
    typicalSessionMinutes > 0 &&
    currentSessionMinutes > typicalSessionMinutes
  ) {
    insights.push(
      `This ${displayDomain(domain)} session is longer than your median ${displayDomain(domain)} session`
    );
  }

  const distractingSite = topDomainForCategory(usageToday, domainCategories, "distracting");
  if (distractingSite) {
    insights.push(
      `Most distracting site today: ${distractingSite.domain} (${displayMinutes(distractingSite.minutes)} min)`
    );
  }

  const focusBlock = bestFocusBlock(
    sessions,
    activeSession,
    domainCategories,
    dateKey,
    resetHour,
    timestamp
  );
  if (focusBlock && focusBlock.durationMinutes > 0) {
    insights.push(
      `Best focus block today: ${displayDomain(focusBlock.domain)} for ${displayMinutes(focusBlock.durationMinutes)} min`
    );
  }

  const switchesToday = contextSwitchCount(sessionsForDate(sessions, dateKey, resetHour));
  insights.push(`Context switches today: ${switchesToday}`);

  return insights.length > 0 ? insights.slice(0, 5) : ["Keep browsing to build insights"];
}

function buildWeeklyTrends(dailyUsage, sessions, dateKey, resetHour, domainCategories) {
  const dateKeys = recentDateKeys(dateKey, 7, resetHour);
  const dailyTotals = dateKeys.map((key) => ({
    date: key,
    minutes: displayMinutes(totalMinutesForDate(dailyUsage, key))
  }));
  const maxDailyMinutes = Math.max(...dailyTotals.map((day) => day.minutes), 1);
  const weeklyUsage = aggregateUsageForDates(dailyUsage, dateKeys);
  const categoryTotals = categoryTotalsForUsage(weeklyUsage, domainCategories);
  const weekSessions = sessionsForDates(sessions, dateKeys, resetHour);
  const totalSessionMinutes = weekSessions.reduce(
    (sum, session) => sum + Number(session.durationMinutes || 0),
    0
  );

  return {
    dailyTotals: dailyTotals.map((day) => ({
      ...day,
      barPercent: Math.round((day.minutes / maxDailyMinutes) * 100)
    })),
    categoryTotals,
    topSites: topUsageEntries(weeklyUsage, 3),
    averageSessionLength:
      weekSessions.length > 0 ? displayMinutes(totalSessionMinutes / weekSessions.length) : 0,
    contextSwitchCount: contextSwitchCount(weekSessions)
  };
}

function serializeDebugDate(value) {
  return value ? toIsoString(value) : "-";
}

async function buildDebugInfo(snapshot, activeSession, currentDomain) {
  const idleState = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);

  return {
    currentDomain: currentDomain || "-",
    activeSessionDomain: activeSession?.domain || "-",
    startedAt: serializeDebugDate(activeSession?.startedAt),
    lastCheckpointAt: serializeDebugDate(activeSession?.lastCheckpointAt),
    idleState,
    focusedWindow: snapshot.focusedWindow
      ? `id ${snapshot.focusedWindow.id}, focused ${Boolean(snapshot.focusedWindow.focused)}`
      : "-",
    activeTabUrl: snapshot.activeTab?.url || "-"
  };
}

async function buildSummary() {
  const now = Date.now();
  const settings = await getSettings();
  const dateKey = localDateKey(now, settings.dailyResetHour);
  const { dailyUsage, trackedDays } = await getDailyUsage();
  const sessions = await getSessions();
  const {
    activeSession,
    trackingPaused,
    excludedDomains,
    domainCategories
  } = await getAppState();
  const focusSnapshot = await getFocusSnapshot();

  // Bug 3 fix: when the popup itself is focused, getFocusSnapshot returns the
  // underlying normal-window tab — but if that lookup still yields null (e.g.
  // all windows minimised), prefer the in-memory activeSession domain so the
  // popup always shows the session that was running before it was opened.
  const currentDomain = focusSnapshot.isExtensionPopupFocused
    ? (activeSession?.domain || focusSnapshot.currentDomain || null)
    : focusSnapshot.currentDomain;

  // Prefer the actively-tracked domain; fall back to what's in the tab right now.
  const domain = activeSession?.domain || currentDomain || null;
  const usageToday = dailyUsage[dateKey] || {};
  const today = domain ? Number(dailyUsage[dateKey]?.[domain] || 0) : 0;
  const trackedToday = totalMinutesForDate(dailyUsage, dateKey);
  const { baseline, recordCount } = baselineForDomain(
    dailyUsage,
    trackedDays,
    dateKey,
    domain,
    BASELINE_WEEKDAY_OCCURRENCES,
    settings.dailyResetHour
  );
  const elapsedMinutesToday = minutesSinceReset(now, settings.dailyResetHour);
  const dailyInsight = predictionInsight(today, baseline, recordCount, trackedToday, elapsedMinutesToday, now);
  const sessionInsight = await buildCurrentSessionInsight(domain, now);
  const categoryBreakdown = categoryTotalsForUsage(usageToday, domainCategories);
  const weeklyTrends = buildWeeklyTrends(
    dailyUsage,
    sessions,
    dateKey,
    settings.dailyResetHour,
    domainCategories
  );
  const insights = buildInsightList({
    domain,
    today,
    baseline,
    baselineRecordCount: recordCount,
    currentSessionMinutes: sessionInsight.currentSessionMinutes,
    typicalSessionMinutes: sessionInsight.typicalSessionMinutes,
    usageToday,
    sessions,
    activeSession,
    domainCategories,
    dateKey,
    resetHour: settings.dailyResetHour,
    timestamp: now
  });
  const debug = await buildDebugInfo(focusSnapshot, activeSession, currentDomain);

  return {
    date: dateKey,
    domain,
    currentDomain,
    trackingPaused,
    excludedDomains,
    currentSiteExcluded: isExcludedDomain(currentDomain, excludedDomains),
    domainCategory: categoryForDomain(domain, domainCategories),
    currentDomainCategory: categoryForDomain(currentDomain, domainCategories),
    categoryBreakdown,
    insights,
    weeklyTrends,
    debug,
    settings,
    baselineType: "same_weekday_average",
    baselineOccurrences: BASELINE_WEEKDAY_OCCURRENCES,
    baselineRecordCount: recordCount,
    baselineConfidence: recordCount >= MIN_BASELINE_RECORDS ? confidenceLabel(recordCount) : "-",
    predictionFormula: "predicted_total = (current_usage / elapsed_minutes_today) * 1440",
    elapsedMinutesToday: displayMinutes(elapsedMinutesToday),
    todayMinutes: displayMinutes(today),
    averageMinutes: dailyInsight.averageMinutes,
    status: dailyInsight.status,
    prediction: dailyInsight.prediction,
    recommendation: dailyInsight.recommendation,
    ...sessionInsight,
    totalTodayMinutes: displayMinutes(trackedToday),
    usage: usageToday
  };
}

// ── Notification + overlay state ──────────────────────────────────────────────
// Tracks the last time we fired a notification per domain so we don't spam.
// Key: domain, value: { thresholdKey, firedAt }
const notificationCooldowns = {};
// Tracks which tabs already have the overlay shown so we can update/hide it.
const tabOverlayState = {};   // tabId -> { domain, shown }

// ── Badge ─────────────────────────────────────────────────────────────────────

async function updateBadge() {
  const settings = await getSettings();
  const dateKey = localDateKey(Date.now(), settings.dailyResetHour);
  const { dailyUsage } = await getDailyUsage();
  const total = displayMinutes(totalMinutesForDate(dailyUsage, dateKey));
  const text = total > 999 ? `${Math.round(total / 60)}h` : String(total);

  // Colour: red if ≥120 min, amber if ≥60 min, blue otherwise
  const color =
    total >= 120 ? "#e24b4a" :
    total >= 60  ? "#ba7517" :
                   "#1f6feb";

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

// ── Alert helpers ─────────────────────────────────────────────────────────────

/**
 * Fire a system notification if the domain has exceeded baseline
 * and we haven't already notified for this threshold in the last hour.
 */
async function maybeNotify(domain, domainMins, averageMinutes, predictedTotal) {
  if (!domain) return;

  const avg = Number(averageMinutes);
  if (isNaN(avg) || avg <= 0) return;

  // We only notify at 100% and 150% of baseline, once per threshold per hour.
  const THRESHOLDS = [
    { key: "150pct", ratio: 1.5,
      title: "Way over your usual time",
      msg: (d, m, a) =>
        `You've spent ${displayMinutes(m)} min on ${displayDomain(d)} — that's 150% of your ${displayMinutes(a)} min average.`
    },
    { key: "100pct", ratio: 1.0,
      title: "You've hit your baseline",
      msg: (d, m, a) =>
        `${displayDomain(d)}: ${displayMinutes(m)} min today — you've reached your usual ${displayMinutes(a)} min.`
    }
  ];

  const now = Date.now();
  const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

  for (const threshold of THRESHOLDS) {
    if (domainMins < avg * threshold.ratio) continue;

    const key = `${domain}:${threshold.key}`;
    const prev = notificationCooldowns[key];
    if (prev && now - prev < COOLDOWN_MS) continue;  // already notified recently

    notificationCooldowns[key] = now;

    chrome.notifications.create(`lifecycle-${key}`, {
      type: "basic",
      iconUrl: "icon.png",
      title: `LifeCycle — ${threshold.title}`,
      message: threshold.msg(domain, domainMins, avg),
      priority: 1
    });

    break;  // only the highest applicable threshold per call
  }
}

/**
 * Send a message to the active tab's content script to show/update/hide
 * the in-page overlay banner.
 */
async function updateOverlay(tabId, domain, domainMins, averageMinutes, sessionMins, typicalSessionMins) {
  if (!tabId) return;

  const avg = Number(averageMinutes);
  const aboveBaseline = !isNaN(avg) && avg > 0 && domainMins >= avg;

  const sessionNum = (sessionMins != null && sessionMins !== "-") ? Number(sessionMins) : null;
  const typNum = (typicalSessionMins != null && typicalSessionMins !== "-") ? Number(typicalSessionMins) : null;
  const longSession = sessionNum != null && typNum != null && typNum > 0 && sessionNum > typNum;

  if (!domain || (!aboveBaseline && !longSession)) {
    // Hide the overlay if nothing to warn about
    if (tabOverlayState[tabId]?.shown) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: "LIFECYCLE_OVERLAY_HIDE" });
      } catch (_) {}
      tabOverlayState[tabId] = { domain, shown: false };
    }
    return;
  }

  let line1 = "";
  let line2 = "";
  let level = "warn"; // "warn" | "danger"

  if (aboveBaseline) {
    const pct = avg > 0 ? Math.round(((domainMins - avg) / avg) * 100) : 0;
    line1 = `${displayDomain(domain)}: ${displayMinutes(domainMins)} min today (+${pct}% above avg)`;
    level = domainMins >= avg * 1.5 ? "danger" : "warn";
  }

  if (longSession) {
    const extra = Math.round(sessionNum - typNum);
    line2 = `Session is ${extra} min over your usual length`;
    if (!line1) level = "warn";
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "LIFECYCLE_OVERLAY_SHOW",
      payload: { line1, line2, level }
    });
    tabOverlayState[tabId] = { domain, shown: true };
  } catch (_) {
    // Content script may not be injected yet — ignore silently
  }
}

async function syncTodayToBackend() {
  const settings = await getSettings();
  const dateKey = localDateKey(Date.now(), settings.dailyResetHour);
  const { dailyUsage, trackedDays } = await getDailyUsage();
  const usage = dailyUsage[dateKey] || {};

  if (!trackedDays[dateKey]) {
    return;
  }

  try {
    await fetch(`${BACKEND_URL}/usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: dateKey, usage, tracked: true })
    });
  } catch (_error) {
    // Local tracking is the source of truth; the backend is optional for V1.
  }
}

async function pauseTrackingManually() {
  await pauseTrackingForIdle(Date.now(), 0, "manual_pause");
  await chrome.storage.local.set({ trackingPaused: true });
  await updateBadge();
  return buildSummary();
}

async function resumeTrackingManually() {
  await chrome.storage.local.set({ trackingPaused: false });
  await refreshActiveContext();
  return buildSummary();
}

async function excludeCurrentSite() {
  const timestamp = Date.now();
  const { currentDomain } = await getFocusSnapshot();
  const { activeSession, excludedDomains } = await getAppState();

  if (!currentDomain) {
    return buildSummary();
  }

  const nextExcludedDomains = Array.from(new Set([...excludedDomains, currentDomain])).sort();

  if (activeSession?.domain === currentDomain) {
    await pauseTrackingForIdle(timestamp, 0, "manual_pause");
  } else {
    await checkpointCurrentUsage(timestamp, { clear: true });
  }

  await chrome.storage.local.set({ excludedDomains: nextExcludedDomains });
  await updateBadge();
  return buildSummary();
}

async function setCurrentSiteCategory(category) {
  const { currentDomain } = await getFocusSnapshot();
  const { domainCategories } = await getAppState();

  if (!currentDomain) {
    return buildSummary();
  }

  await chrome.storage.local.set({
    domainCategories: {
      ...domainCategories,
      [currentDomain]: normalizeCategory(category)
    }
  });

  return buildSummary();
}

async function resetTodaysData() {
  const timestamp = Date.now();
  const settings = await getSettings();
  const dateKey = localDateKey(timestamp, settings.dailyResetHour);
  const { dailyUsage, trackedDays } = await getDailyUsage();
  const {
    activeSession = null,
    currentUsage = null
  } = await chrome.storage.local.get({
    activeSession: null,
    currentUsage: null
  });
  const sessions = await getSessions();
  const nextStorage = {};

  delete dailyUsage[dateKey];
  delete trackedDays[dateKey];

  nextStorage.dailyUsage = dailyUsage;
  nextStorage.trackedDays = trackedDays;
  nextStorage.sessions = sessions.filter(
    (session) => sessionDateKey(session, settings.dailyResetHour) !== dateKey
  );

  if (activeSession?.domain) {
    nextStorage.activeSession = {
      ...activeSession,
      startedAt: timestamp,
      lastCheckpointAt: timestamp,
      lastSeenAt: timestamp,
      date: dateKey
    };
  }

  if (currentUsage?.domain) {
    nextStorage.currentUsage = {
      ...currentUsage,
      startedAt: timestamp,
      lastCheckpointAt: timestamp,
      date: dateKey
    };
  }

  await chrome.storage.local.set(nextStorage);
  await updateBadge();
  await syncTodayToBackend();
  return buildSummary();
}

async function clearAllData() {
  await chrome.storage.local.remove([
    "dailyUsage",
    "trackedDays",
    "sessions",
    "activeSession",
    "currentUsage",
    "trackingPaused",
    "excludedDomains",
    "domainCategories"
  ]);
  await updateBadge();
  await refreshActiveContext();
  return buildSummary();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  chrome.alarms.create("lifecycle-checkpoint", { periodInMinutes: 1 });
  enqueue(refreshActiveContext);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  chrome.alarms.create("lifecycle-checkpoint", { periodInMinutes: 1 });
  enqueue(refreshActiveContext);
});

chrome.idle.onStateChanged.addListener((state) => {
  if (state === "idle" || state === "locked") {
    enqueue(() => pauseTrackingForIdle(Date.now(), IDLE_DETECTION_SECONDS));
    return;
  }

  enqueue(resumeTrackingIfActive);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "lifecycle-checkpoint") {
    enqueue(refreshActiveContext);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  // Ignore activation of the extension popup tab itself — querying it would
  // return a chrome-extension:// URL, which normalizeDomain maps to null,
  // which then triggers pauseTrackingForIdle and kills the active session.
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    if (tab?.url?.startsWith("chrome-extension://")) return;
    enqueue(refreshActiveContext);
  });
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.url) {
    enqueue(refreshActiveContext);
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  // WINDOW_ID_NONE fires briefly as the popup opens — ignore it.
  // We also skip via refreshActiveContext's isExtensionPopupFocused guard,
  // but catching it early here avoids an unnecessary enqueue + storage read.
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  enqueue(refreshActiveContext);
});

chrome.windows.onRemoved.addListener(() => {
  enqueue(refreshActiveContext);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    SAVE_SETTINGS: async () => {
      const timestamp = Date.now();
      await setSettings({
        dailyResetHour: message.settings?.dailyResetHour === 3 ? 3 : 0
      });
      await checkpointActiveSession(timestamp);
      await refreshActiveContext();
      return buildSummary();
    },
    GET_USAGE_SUMMARY: async () => {
      await checkpointActiveSession(Date.now());
      return buildSummary();
    },
    PAUSE_TRACKING: pauseTrackingManually,
    RESUME_TRACKING: resumeTrackingManually,
    EXCLUDE_CURRENT_SITE: excludeCurrentSite,
    RESET_TODAY: resetTodaysData,
    CLEAR_ALL_DATA: clearAllData,
    SET_CURRENT_SITE_CATEGORY: async () => setCurrentSiteCategory(message.category)
  };

  const handler = handlers[message?.type];

  if (!handler) {
    return false;
  }

  enqueue(async () => {
    try {
      const summary = await handler();
      sendResponse(summary);
    } catch (error) {
      console.error("LifeCycle message failed", error);
      sendResponse(null);
    }
  });

  return true;
});
