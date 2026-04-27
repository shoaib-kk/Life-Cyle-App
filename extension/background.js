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

async function saveCompletedSession(activeSession, endedAt) {
  const startedAt = activeSession.startedAt || activeSession.lastCheckpointAt;

  if (!activeSession.domain || !startedAt || endedAt <= startedAt) {
    return;
  }

  const durationMinutes = roundMinutes((endedAt - startedAt) / 60000);

  if (durationMinutes <= 0) {
    return;
  }

  const sessions = await getSessions();
  sessions.push({
    domain: activeSession.domain,
    startTime: toIsoString(startedAt),
    endTime: toIsoString(endedAt),
    durationMinutes
  });

  await chrome.storage.local.set({
    sessions: sessions.slice(-SESSION_HISTORY_LIMIT)
  });
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

async function checkpointActiveSession(timestamp = Date.now(), options = {}) {
  const { activeSession = null } = await chrome.storage.local.get({ activeSession: null });

  if (!activeSession || !activeSession.domain) {
    return;
  }

  const checkpointAt = activeSession.lastCheckpointAt || activeSession.startedAt;
  const endedAt = Math.max(checkpointAt, timestamp - (options.subtractIdleSeconds || 0) * 1000);

  if (!checkpointAt || endedAt <= checkpointAt) {
    return;
  }

  await addUsageMinutes(activeSession.domain, checkpointAt, endedAt);
  await chrome.storage.local.set({
    activeSession: {
      ...activeSession,
      lastCheckpointAt: endedAt,
      date: localDateKey(endedAt, (await getSettings()).dailyResetHour)
    }
  });
}

async function getFocusedActiveTab() {
  // First check if there's actually a focused Chrome window
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const focusedWindow = windows.find((w) => w.focused);

  if (!focusedWindow) {
    return null;
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    windowId: focusedWindow.id
  });

  return tab || null;
}

async function pauseTrackingForIdle(timestamp = Date.now(), subtractIdleSeconds = 0) {
  const { activeSession = null } = await chrome.storage.local.get({ activeSession: null });

  if (!activeSession?.domain) {
    return;
  }

  const checkpointAt = activeSession.lastCheckpointAt || activeSession.startedAt || timestamp;
  const endedAt = Math.max(checkpointAt, timestamp - subtractIdleSeconds * 1000);

  if (endedAt > checkpointAt) {
    await addUsageMinutes(activeSession.domain, checkpointAt, endedAt);
  }

  await saveCompletedSession(activeSession, endedAt);
  await chrome.storage.local.remove("activeSession");
}

async function resumeTrackingIfActive() {
  const idleState = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);

  if (idleState === "active") {
    await refreshActiveContext();
  }
}

async function startSessionForTab(tab, timestamp = Date.now()) {
  const domain = tab?.url ? normalizeDomain(tab.url) : null;
  const { activeSession = null } = await chrome.storage.local.get({ activeSession: null });
  const settings = await getSettings();

  if (!domain) {
    if (activeSession?.domain) {
      await saveCompletedSession(activeSession, timestamp);
    }

    await chrome.storage.local.remove("activeSession");
    return;
  }

  if (activeSession?.domain === domain) {
    // Already tracking this domain — only update window/tab refs, keep timing intact
    await chrome.storage.local.set({
      activeSession: {
        ...activeSession,
        tabId: tab.id,
        windowId: tab.windowId,
        date: localDateKey(timestamp, settings.dailyResetHour)
      }
    });
    return;
  }

  if (activeSession?.domain) {
    await saveCompletedSession(activeSession, timestamp);
  }

  await chrome.storage.local.set({
    activeSession: {
      domain,
      tabId: tab.id,
      windowId: tab.windowId,
      startedAt: timestamp,
      lastCheckpointAt: timestamp,
      date: localDateKey(timestamp, settings.dailyResetHour)
    }
  });
}

async function getCurrentTrackedDomain() {
  const activeTab = await getFocusedActiveTab();
  return activeTab?.url ? normalizeDomain(activeTab.url) : null;
}

async function refreshActiveContext() {
  const timestamp = Date.now();
  const idleState = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);

  if (idleState !== "active") {
    await pauseTrackingForIdle(timestamp, IDLE_DETECTION_SECONDS);
    await updateBadge();
    return;
  }

  // Checkpoint first so any elapsed time on the current session is saved
  await checkpointActiveSession(timestamp);

  const activeTab = await getFocusedActiveTab();
  const newDomain = activeTab?.url ? normalizeDomain(activeTab.url) : null;
  const { activeSession = null } = await chrome.storage.local.get({ activeSession: null });

  // If the domain has changed, close out the old session and start fresh
  if (activeSession?.domain && newDomain !== activeSession.domain) {
    await saveCompletedSession(activeSession, timestamp);
    await chrome.storage.local.remove("activeSession");
  }

  await startSessionForTab(activeTab, timestamp);
  await updateBadge();
  await syncTodayToBackend();
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
  const { activeSession = null } = await chrome.storage.local.get({ activeSession: null });
  const idleState = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);

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

  // Use lastCheckpointAt as the session start for display so idle gaps don't inflate the timer
  const sessionStart = activeSession.lastCheckpointAt || activeSession.startedAt || timestamp;
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

async function buildSummary() {
  const now = Date.now();
  const settings = await getSettings();
  const dateKey = localDateKey(now, settings.dailyResetHour);
  const { dailyUsage, trackedDays } = await getDailyUsage();
  const { activeSession = null } = await chrome.storage.local.get({ activeSession: null });
  const currentDomain = await getCurrentTrackedDomain();
  // Prefer the actively-tracked domain; fall back to what's in the tab right now
  const domain = activeSession?.domain || currentDomain || null;
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

  return {
    date: dateKey,
    domain,
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
    usage: dailyUsage[dateKey] || {}
  };
}

async function updateBadge() {
  const settings = await getSettings();
  const dateKey = localDateKey(Date.now(), settings.dailyResetHour);
  const { dailyUsage } = await getDailyUsage();
  const total = displayMinutes(totalMinutesForDate(dailyUsage, dateKey));
  const text = total > 999 ? `${Math.round(total / 60)}h` : String(total);

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#1f6feb" });
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

chrome.tabs.onActivated.addListener(() => {
  enqueue(refreshActiveContext);
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.url) {
    enqueue(refreshActiveContext);
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  enqueue(refreshActiveContext);
});

chrome.windows.onRemoved.addListener(() => {
  enqueue(refreshActiveContext);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SAVE_SETTINGS") {
    enqueue(async () => {
      const timestamp = Date.now();
      await setSettings({
        dailyResetHour: message.settings?.dailyResetHour === 3 ? 3 : 0
      });
      await checkpointActiveSession(timestamp);
      await refreshActiveContext();
      const summary = await buildSummary();
      sendResponse(summary);
    });

    return true;
  }

  if (message?.type !== "GET_USAGE_SUMMARY") {
    return false;
  }

  enqueue(async () => {
    await refreshActiveContext();
    const summary = await buildSummary();
    sendResponse(summary);
  });

  return true;
});