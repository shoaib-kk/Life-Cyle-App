const BACKEND_URL = "http://127.0.0.1:8000";
const BASELINE_DAYS = 7;
const FULL_DAY_MINUTES = 24 * 60;

let operationQueue = Promise.resolve();

function enqueue(task) {
  operationQueue = operationQueue.then(task, task).catch((error) => {
    console.error("LifeCycle background task failed", error);
  });
  return operationQueue;
}

function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousDateKeys(dateKey, count) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const keys = [];

  for (let index = 1; index <= count; index += 1) {
    const previous = new Date(date);
    previous.setDate(date.getDate() - index);
    keys.push(localDateKey(previous.getTime()));
  }

  return keys;
}

function minutesSinceLocalMidnight(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const midnight = new Date(date);
  midnight.setHours(0, 0, 0, 0);
  return Math.max(1, (timestamp - midnight.getTime()) / 60000);
}

function nextLocalMidnight(timestamp) {
  const date = new Date(timestamp);
  date.setHours(24, 0, 0, 0);
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

function statusText(today, baseline) {
  if (baseline <= 0) {
    return today > 0 ? "New activity today" : "No usage yet";
  }

  const delta = (today - baseline) / baseline;
  const percent = Math.round(delta * 100);

  if (percent > 0) {
    return `+${percent}% above normal`;
  }

  if (percent < 0) {
    return `${percent}% below normal`;
  }

  return "On your normal pace";
}

function recommendationText(today, baseline, predictedTotal) {
  if (baseline > 0 && predictedTotal > baseline) {
    return "You're trending higher than usual - consider stopping now to stay within your average";
  }

  if (baseline > 0 && today < baseline) {
    return "You're below your usual pace - keep it there if that is the goal";
  }

  if (today > 0) {
    return "Keep tracking today so your baseline can become meaningful";
  }

  return "No active usage recorded yet today";
}

async function getDailyUsage() {
  const { dailyUsage = {} } = await chrome.storage.local.get({ dailyUsage: {} });
  return dailyUsage;
}

async function setDailyUsage(dailyUsage) {
  await chrome.storage.local.set({ dailyUsage });
}

async function addUsageMinutes(domain, startedAt, endedAt) {
  if (!domain || endedAt <= startedAt) {
    return;
  }

  const dailyUsage = await getDailyUsage();
  let cursor = startedAt;

  while (cursor < endedAt) {
    const boundary = Math.min(nextLocalMidnight(cursor), endedAt);
    const dateKey = localDateKey(cursor);
    const minutes = (boundary - cursor) / 60000;

    if (!dailyUsage[dateKey]) {
      dailyUsage[dateKey] = {};
    }

    dailyUsage[dateKey][domain] = roundMinutes((dailyUsage[dateKey][domain] || 0) + minutes);
    cursor = boundary;
  }

  await setDailyUsage(dailyUsage);
}

async function checkpointActiveSession(timestamp = Date.now()) {
  const { activeSession = null } = await chrome.storage.local.get({ activeSession: null });

  if (!activeSession || !activeSession.domain || !activeSession.startedAt) {
    return;
  }

  if (timestamp <= activeSession.startedAt) {
    return;
  }

  await addUsageMinutes(activeSession.domain, activeSession.startedAt, timestamp);
  await chrome.storage.local.set({
    activeSession: {
      ...activeSession,
      startedAt: timestamp,
      date: localDateKey(timestamp)
    }
  });
}

async function getFocusedActiveTab() {
  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ["normal"]
  });
  const focusedWindow = windows.find((windowInfo) => windowInfo.focused);

  if (!focusedWindow) {
    return null;
  }

  return focusedWindow.tabs.find((tab) => tab.active) || null;
}

async function startSessionForTab(tab, timestamp = Date.now()) {
  const domain = tab?.url ? normalizeDomain(tab.url) : null;

  if (!domain) {
    await chrome.storage.local.remove("activeSession");
    return;
  }

  await chrome.storage.local.set({
    activeSession: {
      domain,
      tabId: tab.id,
      windowId: tab.windowId,
      startedAt: timestamp,
      date: localDateKey(timestamp)
    }
  });
}

async function refreshActiveContext() {
  const timestamp = Date.now();
  await checkpointActiveSession(timestamp);
  const activeTab = await getFocusedActiveTab();
  await startSessionForTab(activeTab, timestamp);
  await updateBadge();
  await syncTodayToBackend();
}

function totalMinutesForDate(dailyUsage, dateKey) {
  return Object.values(dailyUsage[dateKey] || {}).reduce((sum, minutes) => sum + Number(minutes || 0), 0);
}

function topDomainForDate(dailyUsage, dateKey) {
  const entries = Object.entries(dailyUsage[dateKey] || {});

  if (entries.length === 0) {
    return null;
  }

  entries.sort((left, right) => right[1] - left[1]);
  return entries[0][0];
}

function baselineForDomain(dailyUsage, dateKey, domain, days = BASELINE_DAYS) {
  if (!domain) {
    return 0;
  }

  const dates = previousDateKeys(dateKey, days);
  const total = dates.reduce((sum, previousDate) => {
    return sum + Number(dailyUsage[previousDate]?.[domain] || 0);
  }, 0);

  return total / days;
}

async function buildSummary() {
  const now = Date.now();
  const dateKey = localDateKey(now);
  const dailyUsage = await getDailyUsage();
  const domain = topDomainForDate(dailyUsage, dateKey);
  const today = domain ? Number(dailyUsage[dateKey]?.[domain] || 0) : 0;
  const baseline = baselineForDomain(dailyUsage, dateKey, domain);
  const predictedTotal = (today / minutesSinceLocalMidnight(now)) * FULL_DAY_MINUTES;

  return {
    date: dateKey,
    domain,
    todayMinutes: displayMinutes(today),
    averageMinutes: displayMinutes(baseline),
    status: statusText(today, baseline),
    prediction: `~${displayMinutes(predictedTotal)} min today`,
    recommendation: recommendationText(today, baseline, predictedTotal),
    totalTodayMinutes: displayMinutes(totalMinutesForDate(dailyUsage, dateKey)),
    usage: dailyUsage[dateKey] || {}
  };
}

async function updateBadge() {
  const dateKey = localDateKey();
  const dailyUsage = await getDailyUsage();
  const total = displayMinutes(totalMinutesForDate(dailyUsage, dateKey));
  const text = total > 999 ? `${Math.round(total / 60)}h` : String(total);

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#1f6feb" });
}

async function syncTodayToBackend() {
  const dateKey = localDateKey();
  const dailyUsage = await getDailyUsage();
  const usage = dailyUsage[dateKey] || {};

  if (Object.keys(usage).length === 0) {
    return;
  }

  try {
    await fetch(`${BACKEND_URL}/usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: dateKey, usage })
    });
  } catch (_error) {
    // Local tracking is the source of truth; the backend is optional for V1.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("lifecycle-checkpoint", { periodInMinutes: 1 });
  enqueue(refreshActiveContext);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("lifecycle-checkpoint", { periodInMinutes: 1 });
  enqueue(refreshActiveContext);
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
  if (message?.type !== "GET_USAGE_SUMMARY") {
    return false;
  }

  enqueue(async () => {
    await checkpointActiveSession();
    await updateBadge();
    await syncTodayToBackend();
    const summary = await buildSummary();
    sendResponse(summary);
  });

  return true;
});
