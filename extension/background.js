const DEFAULT_BACKEND_URL = "https://yourdomain.com";
const AUTH_CALLBACK_PATH = "/extension-callback";
const STORAGE_SCHEMA_VERSION = 1;
const BASELINE_WEEKDAY_OCCURRENCES = 8;
const FULL_DAY_MINUTES = 24 * 60;
const ABOVE_BASELINE_THRESHOLD = 0.3;
const SESSION_HISTORY_LIMIT_PER_DOMAIN = 100;
const SESSION_HISTORY_GLOBAL_LIMIT = 5000;
const IDLE_DETECTION_SECONDS = 60;
const MIN_BASELINE_RECORDS = 2;
const MIN_SESSION_HISTORY = 2;
const MIN_TRACKED_DAY_MINUTES_FOR_PREDICTION = 30;
const MIN_DOMAIN_MINUTES_FOR_PREDICTION = 10;
const DAILY_HISTORY_RETENTION_DAYS = 70;
const SESSION_GAP_THRESHOLD_MS = 5 * 60 * 1000;
const BACKEND_SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;
const BACKEND_SYNC_ERROR_LOG_INTERVAL_MS = 15 * 60 * 1000;
const OVERLAY_COOLDOWN_MS = 30 * 60 * 1000;
const OVERLAY_SESSION_RATIO = 1.3;
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
const TASK_GROUP_RULES = [
  {
    group: "study",
    patterns: [/study/i, /assignment/i, /mast\d+/i, /unimelb/i, /lecture/i, /exam/i],
    domains: ["lms.unimelb.edu.au", "canvas.lms.unimelb.edu.au", "edstem.org", "overleaf.com", "docs.google.com"]
  },
  {
    group: "coding",
    patterns: [/code/i, /coding/i, /github/i, /program/i, /debug/i],
    domains: ["github.com", "stackoverflow.com", "developer.mozilla.org", "docs.python.org"]
  },
  {
    group: "job search",
    patterns: [/job/i, /career/i, /resume/i, /linkedin/i, /interview/i],
    domains: ["linkedin.com", "seek.com.au", "indeed.com", "docs.google.com"]
  }
];
const TASK_DEFAULT_ALLOWED_DOMAINS = ["google.com", "docs.google.com"];
const DEFAULT_TASK_PROFILES = [
  {
    id: "profile-study",
    name: "Study",
    group: "study",
    allowedDomains: ["lms.unimelb.edu.au", "chatgpt.com", "google.com", "docs.google.com"],
    blockedDomains: ["youtube.com", "reddit.com"],
    defaultDuration: 60
  },
  {
    id: "profile-coding",
    name: "Coding",
    group: "coding",
    allowedDomains: ["github.com", "stackoverflow.com", "developer.mozilla.org", "docs.python.org"],
    blockedDomains: ["youtube.com", "reddit.com", "instagram.com"],
    defaultDuration: 90
  },
  {
    id: "profile-job-applications",
    name: "Job applications",
    group: "job search",
    allowedDomains: ["linkedin.com", "seek.com.au", "indeed.com", "docs.google.com"],
    blockedDomains: ["youtube.com", "reddit.com", "instagram.com"],
    defaultDuration: 60
  },
  {
    id: "profile-assignment-writing",
    name: "Assignment writing",
    group: "study",
    allowedDomains: ["lms.unimelb.edu.au", "overleaf.com", "docs.google.com", "chatgpt.com"],
    blockedDomains: ["youtube.com", "reddit.com", "instagram.com"],
    defaultDuration: 120
  }
];
const DOMAIN_CLASSIFICATION_RULES = {
  "github.com": "Coding",
  "linkedin.com": "Job search",
  "lms.unimelb.edu.au": "Study",
  "youtube.com": "Entertainment",
  "reddit.com": "Entertainment"
};
const TASK_OVERRIDE_DURATION_MS = 5 * 60 * 1000;

let operationQueue = Promise.resolve();
let lastBackendSyncAt = 0;
let lastBackendSyncSignature = "";
let lastBackendSyncErrorLogAt = 0;

function enqueue(task) {
  const queuedTask = operationQueue.then(() => task());
  operationQueue = queuedTask.catch((error) => {
    console.error("LifeCycle background task failed", error);
  });
  return queuedTask;
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

async function getBackendUrl() {
  const { backendUrl = DEFAULT_BACKEND_URL } = await chrome.storage.local.get({
    backendUrl: DEFAULT_BACKEND_URL
  });
  return String(backendUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
}

function normalizeSessionShape(session) {
  if (!session || typeof session !== "object") {
    return session;
  }

  return {
    ...session,
    startedAt: session.startedAt || session.startTime,
    endedAt: session.endedAt || session.endTime
  };
}

async function migrateStorage() {
  const {
    schemaVersion = 0,
    activeSession = null,
    currentUsage = null,
    sessions = []
  } = await chrome.storage.local.get({
    schemaVersion: 0,
    activeSession: null,
    currentUsage: null,
    sessions: []
  });

  if (schemaVersion >= STORAGE_SCHEMA_VERSION) {
    return;
  }

  const updates = {
    schemaVersion: STORAGE_SCHEMA_VERSION
  };

  if (activeSession) {
    updates.activeSession = normalizeSessionShape(activeSession);
  }

  if (currentUsage) {
    updates.currentUsage = normalizeSessionShape(currentUsage);
  }

  if (Array.isArray(sessions)) {
    updates.sessions = pruneSessionHistory(sessions.map(normalizeSessionShape));
  }

  await chrome.storage.local.set(updates);
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

function normalizeAllowedDomain(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw) {
    return null;
  }

  const url = raw.includes("://") ? raw : `https://${raw}`;

  try {
    let hostname = new URL(url).hostname.toLowerCase();
    if (hostname.startsWith("www.")) {
      hostname = hostname.slice(4);
    }
    return hostname || null;
  } catch (_error) {
    return raw.replace(/^www\./, "") || null;
  }
}

function normalizeAllowedDomains(values = []) {
  const domains = Array.isArray(values)
    ? values
    : String(values || "").split(/[\n,]+/);
  return Array.from(new Set(domains.map(normalizeAllowedDomain).filter(Boolean))).sort();
}

function normalizeTaskProfile(profile, fallback = {}) {
  const name = String(profile?.name || fallback.name || "Focus").trim() || "Focus";
  const id = String(profile?.id || fallback.id || `profile-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`).replace(/-+$/g, "");
  return {
    id,
    name,
    group: String(profile?.group || fallback.group || name.toLowerCase()).trim() || "focus",
    allowedDomains: normalizeAllowedDomains(profile?.allowedDomains || fallback.allowedDomains || []),
    blockedDomains: normalizeAllowedDomains(profile?.blockedDomains || fallback.blockedDomains || []),
    defaultDuration: Math.max(5, Math.min(480, Number(profile?.defaultDuration || fallback.defaultDuration || 60)))
  };
}

async function getTaskProfiles() {
  const { taskProfiles = null } = await chrome.storage.local.get({ taskProfiles: null });

  if (!Array.isArray(taskProfiles) || taskProfiles.length === 0) {
    const defaults = DEFAULT_TASK_PROFILES.map((profile) => normalizeTaskProfile(profile));
    await chrome.storage.local.set({ taskProfiles: defaults });
    return defaults;
  }

  return taskProfiles.map((profile) => normalizeTaskProfile(profile));
}

async function saveTaskProfile(profile) {
  const profiles = await getTaskProfiles();
  const normalized = normalizeTaskProfile(profile);
  const index = profiles.findIndex((item) => item.id === normalized.id);

  if (index >= 0) {
    profiles[index] = normalized;
  } else {
    profiles.push(normalized);
  }

  await chrome.storage.local.set({ taskProfiles: profiles });
  return { profiles, profile: normalized };
}

async function deleteTaskProfile(profileId) {
  const profiles = (await getTaskProfiles()).filter((profile) => profile.id !== profileId);
  await chrome.storage.local.set({ taskProfiles: profiles });
  return { profiles };
}

function classifyDomain(domain) {
  if (!domain) {
    return "Unknown";
  }

  const matched = Object.entries(DOMAIN_CLASSIFICATION_RULES).find(([ruleDomain]) => {
    return domain === ruleDomain || domain.endsWith(`.${ruleDomain}`);
  });
  return matched ? matched[1] : "Other";
}

function isAllowedForTask(domain, allowedDomains = []) {
  return Boolean(
    domain &&
      allowedDomains.some((allowedDomain) => {
        return domain === allowedDomain || domain.endsWith(`.${allowedDomain}`);
      })
  );
}

function taskSuggestionForTitle(title) {
  const text = String(title || "").trim();
  const matchedRule = TASK_GROUP_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(text)));
  const rule = matchedRule || {
    group: "focus",
    domains: TASK_DEFAULT_ALLOWED_DOMAINS
  };

  return {
    title: text,
    group: rule.group,
    allowedDomains: normalizeAllowedDomains(rule.domains),
    blockedDomains: normalizeAllowedDomains(["youtube.com", "reddit.com", "instagram.com"]),
    defaultDuration: rule.group === "coding" ? 90 : 60,
    note: matchedRule
      ? `Suggested from ${rule.group} rules. Review before starting.`
      : "Suggested a small default focus set. Add any resources you need."
  };
}

function emptyTaskMetrics() {
  return {
    allowedMs: 0,
    blockedMs: 0,
    idleMs: 0,
    tabSwitches: 0,
    blockedAttempts: 0,
    overrideCount: 0
  };
}

function emptyDistractingDomainCounts() {
  return {};
}

function taskQuality(taskSession) {
  const metrics = taskSession?.metrics || emptyTaskMetrics();
  const activeMs = metrics.allowedMs + metrics.blockedMs;
  const allowedRatio = activeMs > 0 ? metrics.allowedMs / activeMs : 1;
  const penalty = metrics.blockedAttempts * 3 + metrics.overrideCount * 8 + metrics.tabSwitches * 0.5;
  return Math.max(0, Math.min(100, Math.round(allowedRatio * 100 - penalty)));
}

async function getTaskSession() {
  const { taskSession = null } = await chrome.storage.local.get({ taskSession: null });
  return taskSession && taskSession.active ? taskSession : null;
}

async function setTaskSession(taskSession) {
  await chrome.storage.local.set({ taskSession });
}

async function getTaskSessionHistory() {
  const { taskSessionHistory = [] } = await chrome.storage.local.get({ taskSessionHistory: [] });
  return Array.isArray(taskSessionHistory) ? taskSessionHistory : [];
}

function taskSessionSummaryForHistory(taskSession, endedAt = Date.now()) {
  const metrics = {
    ...emptyTaskMetrics(),
    ...(taskSession.metrics || {})
  };
  const distractingDomainCounts = taskSession.distractingDomainCounts || emptyDistractingDomainCounts();

  return {
    id: taskSession.id,
    profileId: taskSession.profileId || null,
    profileName: taskSession.profileName || taskSession.group || "Focus",
    title: taskSession.title,
    group: taskSession.group,
    startedAt: taskSession.startedAt,
    endedAt,
    durationMinutes: Math.max(0, Math.round((endedAt - Number(taskSession.startedAt || endedAt)) / 60000)),
    allowedMinutes: Math.round((metrics.allowedMs || 0) / 60000),
    blockedMinutes: Math.round((metrics.blockedMs || 0) / 60000),
    idleMinutes: Math.round((metrics.idleMs || 0) / 60000),
    tabSwitches: metrics.tabSwitches || 0,
    blockedAttempts: metrics.blockedAttempts || 0,
    overrideCount: metrics.overrideCount || 0,
    qualityScore: taskQuality(taskSession),
    distractingDomainCounts,
    overrideLog: taskSession.overrideLog || []
  };
}

function profileAnalyticsFromHistory(history, profiles) {
  const analytics = {};

  for (const profile of profiles) {
    analytics[profile.id] = {
      profileId: profile.id,
      profileName: profile.name,
      totalFocusMinutes: 0,
      averageSessionQuality: null,
      blockedAttempts: 0,
      overrideCount: 0,
      mostDistractingDomains: [],
      sessionCount: 0
    };
  }

  for (const session of history) {
    const key = session.profileId || `ad-hoc:${session.profileName || session.group || "Focus"}`;
    if (!analytics[key]) {
      analytics[key] = {
        profileId: key,
        profileName: session.profileName || session.group || "Focus",
        totalFocusMinutes: 0,
        averageSessionQuality: null,
        blockedAttempts: 0,
        overrideCount: 0,
        mostDistractingDomains: [],
        sessionCount: 0
      };
    }

    const item = analytics[key];
    item.totalFocusMinutes += Number(session.allowedMinutes || 0);
    item.blockedAttempts += Number(session.blockedAttempts || 0);
    item.overrideCount += Number(session.overrideCount || 0);
    item.sessionCount += 1;
    item._qualityTotal = Number(item._qualityTotal || 0) + Number(session.qualityScore || 0);
    item._domainCounts = item._domainCounts || {};

    for (const [domain, count] of Object.entries(session.distractingDomainCounts || {})) {
      item._domainCounts[domain] = (item._domainCounts[domain] || 0) + Number(count || 0);
    }
  }

  for (const item of Object.values(analytics)) {
    item.averageSessionQuality =
      item.sessionCount > 0 ? Math.round(Number(item._qualityTotal || 0) / item.sessionCount) : null;
    item.mostDistractingDomains = Object.entries(item._domainCounts || {})
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([domain, count]) => ({ domain, count, classification: classifyDomain(domain) }));
    delete item._qualityTotal;
    delete item._domainCounts;
  }

  return analytics;
}

function taskSnapshot(taskSession) {
  if (!taskSession) {
    return {
      active: false,
      current: null,
      qualityScore: null
    };
  }

  const metrics = taskSession.metrics || emptyTaskMetrics();
  const activeMs = metrics.allowedMs + metrics.blockedMs;
  return {
    active: true,
    current: {
      id: taskSession.id,
      title: taskSession.title,
      group: taskSession.group,
      profileId: taskSession.profileId || null,
      profileName: taskSession.profileName || taskSession.group,
      allowedDomains: taskSession.allowedDomains || [],
      blockedDomains: taskSession.blockedDomains || [],
      defaultDuration: taskSession.defaultDuration || null,
      startedAt: taskSession.startedAt,
      metrics,
      distractingDomainCounts: taskSession.distractingDomainCounts || emptyDistractingDomainCounts(),
      qualityScore: taskQuality(taskSession),
      allowedPercent: activeMs > 0 ? Math.round((metrics.allowedMs / activeMs) * 100) : 100,
      elapsedMinutes: Math.max(0, Math.round((Date.now() - Number(taskSession.startedAt || Date.now())) / 60000))
    }
  };
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

function predictionForDay(currentUsage, observedMinutesToday) {
  if (observedMinutesToday <= 0) {
    return null;
  }

  return (currentUsage / observedMinutesToday) * FULL_DAY_MINUTES;
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

function statusInfoForPrediction(predictedTotal, baseline) {
  if (baseline <= 0) {
    return predictedTotal > 0
      ? { code: "new_activity", tone: "muted", label: "New activity today", percent: null }
      : { code: "no_usage", tone: "muted", label: "No usage yet", percent: null };
  }

  const delta = (predictedTotal - baseline) / baseline;
  const percent = Math.round(delta * 100);

  if (percent > 0) {
    return {
      code: "above",
      tone: percent >= ABOVE_BASELINE_THRESHOLD * 100 ? "warn" : "ok",
      label: `+${percent}% above normal`,
      percent
    };
  }

  if (percent < 0) {
    return {
      code: "below",
      tone: "ok",
      label: `${percent}% below normal`,
      percent
    };
  }

  return { code: "on_pace", tone: "ok", label: "On your normal pace", percent: 0 };
}

function statusText(predictedTotal, baseline) {
  return statusInfoForPrediction(predictedTotal, baseline).label;
}

function predictionInsight(today, baseline, baselineCount, trackedToday, timestamp) {
  if (baselineCount < MIN_BASELINE_RECORDS) {
    return {
      averageMinutes: "-",
      status: "-",
      statusInfo: { code: "not_ready", tone: "muted", label: "-", percent: null },
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
      statusInfo: { code: "baseline_ready", tone: "ok", label: "Baseline ready", percent: null },
      prediction: hour < 10 ? "Early in day" : "-",
      recommendation: "",
      predictedTotal: null
    };
  }

  const predictedTotal = predictionForDay(today, trackedToday);
  if (predictedTotal === null) {
    return {
      averageMinutes: displayMinutes(baseline),
      status: "Baseline ready",
      statusInfo: { code: "baseline_ready", tone: "ok", label: "Baseline ready", percent: null },
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
    statusInfo: statusInfoForPrediction(predictedTotal, baseline),
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

async function getAuthState() {
  const {
    authToken = null,
    authEmail = null,
    authUserId = null,
    authError = ""
  } = await chrome.storage.local.get({
    authToken: null,
    authEmail: null,
    authUserId: null,
    authError: ""
  });

  return { authToken, authEmail, authUserId, authError };
}

async function getAuthToken() {
  return (await getAuthState()).authToken;
}

async function authHeaders() {
  const token = await getAuthToken();

  if (!token) {
    return null;
  }

  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  };
}

async function clearAuthState(authError = "") {
  await chrome.storage.local.remove(["authToken", "authEmail", "authUserId"]);
  await chrome.storage.local.set({ authError });
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

function pruneSessionHistory(sessions) {
  const countsByDomain = new Map();
  const kept = [];

  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const session = sessions[index];
    const domain = session?.domain || "";
    const count = countsByDomain.get(domain) || 0;

    if (count < SESSION_HISTORY_LIMIT_PER_DOMAIN) {
      kept.push(session);
      countsByDomain.set(domain, count + 1);
    }
  }

  return kept.reverse().slice(-SESSION_HISTORY_GLOBAL_LIMIT);
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
    sessions: pruneSessionHistory(sessions)
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

function projectedUsageForDate(dailyUsage, dateKey, currentUsage, timestamp, resetHour = 0) {
  const usageToday = { ...(dailyUsage[dateKey] || {}) };

  if (!currentUsage?.domain) {
    return usageToday;
  }

  let cursor = Number(currentUsage.lastCheckpointAt || currentUsage.startedAt || timestamp);

  if (!Number.isFinite(cursor) || cursor >= timestamp) {
    return usageToday;
  }

  while (cursor < timestamp) {
    const boundary = Math.min(nextLocalReset(cursor, resetHour), timestamp);

    if (localDateKey(cursor, resetHour) === dateKey) {
      usageToday[currentUsage.domain] = roundMinutes(
        (usageToday[currentUsage.domain] || 0) + (boundary - cursor) / 60000
      );
    }

    cursor = boundary;
  }

  return usageToday;
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

async function checkpointTaskSession(snapshot, timestamp = Date.now()) {
  const taskSession = await getTaskSession();

  if (!taskSession) {
    return null;
  }

  const metrics = {
    ...emptyTaskMetrics(),
    ...(taskSession.metrics || {})
  };
  const lastCheckpointAt = Number(taskSession.lastCheckpointAt || taskSession.startedAt || timestamp);
  const elapsedMs = Math.max(0, timestamp - lastCheckpointAt);
  const domain = snapshot?.currentDomain || null;
  const idleState = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);

  if (elapsedMs > 0) {
    if (idleState !== "active" || !snapshot?.focusedWindow) {
      metrics.idleMs += elapsedMs;
    } else if (isAllowedForTask(domain, taskSession.allowedDomains)) {
      metrics.allowedMs += elapsedMs;
    } else if (domain) {
      metrics.blockedMs += elapsedMs;
    }
  }

  if (
    taskSession.lastDomain &&
    domain &&
    taskSession.lastDomain !== domain &&
    isAllowedForTask(taskSession.lastDomain, taskSession.allowedDomains) &&
    isAllowedForTask(domain, taskSession.allowedDomains)
  ) {
    metrics.tabSwitches += 1;
  }

  const nextTaskSession = {
    ...taskSession,
    metrics,
    lastDomain: domain || taskSession.lastDomain || null,
    lastCheckpointAt: timestamp
  };

  await setTaskSession(nextTaskSession);
  return nextTaskSession;
}

function taskOverrideForDomain(taskSession, domain, timestamp = Date.now()) {
  const override = taskSession?.overrides?.[domain];
  return override && Number(override.expiresAt || 0) > timestamp ? override : null;
}

async function hideTaskBlocker(tabId) {
  if (!tabId) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, { type: "LIFECYCLE_TASK_BLOCKER_HIDE" });
  } catch (_error) {
    // Content script may not be available on browser pages.
  }
}

async function showTaskBlocker(tabId, taskSession, domain) {
  if (!tabId || !taskSession || !domain) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "LIFECYCLE_TASK_BLOCKER_SHOW",
      payload: {
        taskTitle: taskSession.title,
        group: taskSession.group,
        domain,
        allowedDomains: taskSession.allowedDomains || []
      }
    });
  } catch (_error) {
    // Content script may not be available on browser pages.
  }
}

async function enforceTaskMode(snapshot, timestamp = Date.now()) {
  const taskSession = await checkpointTaskSession(snapshot, timestamp);

  if (!taskSession || !snapshot?.activeTab?.id) {
    return;
  }

  const domain = snapshot.currentDomain || null;

  if (!domain) {
    await hideTaskBlocker(snapshot.activeTab.id);
    return;
  }

  if (
    isAllowedForTask(domain, taskSession.allowedDomains) ||
    taskOverrideForDomain(taskSession, domain, timestamp)
  ) {
    await hideTaskBlocker(snapshot.activeTab.id);
    return;
  }

  const blockedKey = `${snapshot.activeTab.id}:${domain}`;
  const updates = {};

  if (taskSession.lastBlockedKey !== blockedKey) {
    updates.metrics = {
      ...emptyTaskMetrics(),
      ...(taskSession.metrics || {}),
      blockedAttempts: Number(taskSession.metrics?.blockedAttempts || 0) + 1
    };
    updates.distractingDomainCounts = {
      ...(taskSession.distractingDomainCounts || {}),
      [domain]: Number(taskSession.distractingDomainCounts?.[domain] || 0) + 1
    };
    updates.lastBlockedKey = blockedKey;
  }

  const nextTaskSession = Object.keys(updates).length > 0
    ? { ...taskSession, ...updates }
    : taskSession;

  if (nextTaskSession !== taskSession) {
    await setTaskSession(nextTaskSession);
  }

  await showTaskBlocker(snapshot.activeTab.id, nextTaskSession, domain);
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

  await enforceTaskMode(
    { focusedWindow, activeTab, currentDomain: newDomain },
    timestamp
  );

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

function totalMinutes(usage = {}) {
  return Object.values(usage).reduce((sum, minutes) => sum + Number(minutes || 0), 0);
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
    currentUsage,
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
  const usageToday = projectedUsageForDate(
    dailyUsage,
    dateKey,
    trackingPaused ? null : currentUsage,
    now,
    settings.dailyResetHour
  );
  const today = domain ? Number(usageToday[domain] || 0) : 0;
  const projectedTrackedToday = totalMinutes(usageToday);
  const { baseline, recordCount } = baselineForDomain(
    dailyUsage,
    trackedDays,
    dateKey,
    domain,
    BASELINE_WEEKDAY_OCCURRENCES,
    settings.dailyResetHour
  );
  const elapsedMinutesToday = minutesSinceReset(now, settings.dailyResetHour);
  const dailyInsight = predictionInsight(today, baseline, recordCount, projectedTrackedToday, now);
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
  const taskSession = await getTaskSession();
  const taskProfiles = await getTaskProfiles();
  const taskSessionHistory = await getTaskSessionHistory();
  const taskProfileAnalytics = profileAnalyticsFromHistory(taskSessionHistory, taskProfiles);

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
    taskMode: taskSnapshot(taskSession),
    taskProfiles,
    taskProfileAnalytics,
    debug,
    settings,
    baselineType: "same_weekday_average",
    baselineOccurrences: BASELINE_WEEKDAY_OCCURRENCES,
    baselineRecordCount: recordCount,
    baselineConfidence: recordCount >= MIN_BASELINE_RECORDS ? confidenceLabel(recordCount) : "-",
    predictionFormula: "predicted_total = (current_site_usage / tracked_active_minutes_today) * 1440",
    elapsedMinutesToday: displayMinutes(elapsedMinutesToday),
    trackedActiveMinutesToday: displayMinutes(projectedTrackedToday),
    todayMinutes: displayMinutes(today),
    averageMinutes: dailyInsight.averageMinutes,
    status: dailyInsight.status,
    statusInfo: dailyInsight.statusInfo,
    prediction: dailyInsight.prediction,
    predictedTotal: dailyInsight.predictedTotal,
    recommendation: dailyInsight.recommendation,
    ...sessionInsight,
    totalTodayMinutes: displayMinutes(projectedTrackedToday),
    usage: usageToday
  };
}

// ── Notification + overlay state ──────────────────────────────────────────────
// Tracks the last time we fired a notification per domain so we don't spam.
// Key: domain, value: { thresholdKey, firedAt }
const notificationCooldowns = {};
// Tracks which tabs already have the overlay shown so we can update/hide it.
const tabOverlayState = {};   // tabId -> { domain, shown, lastShownAt, lastThresholdKey }

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
  const above100 = !isNaN(avg) && avg > 0 && domainMins >= avg;
  const above150 = !isNaN(avg) && avg > 0 && domainMins >= avg * 1.5;

  const sessionNum = (sessionMins != null && sessionMins !== "-") ? Number(sessionMins) : null;
  const typNum = (typicalSessionMins != null && typicalSessionMins !== "-") ? Number(typicalSessionMins) : null;
  const longSession =
    sessionNum != null &&
    typNum != null &&
    typNum > 0 &&
    sessionNum > typNum * OVERLAY_SESSION_RATIO;
  const dailyThresholdKey = above150 ? "150pct" : above100 ? "100pct" : null;
  const sessionThresholdKey = longSession ? "session130pct" : null;
  const thresholdKey = [dailyThresholdKey, sessionThresholdKey].filter(Boolean).join("+");

  if (!domain || !thresholdKey) {
    // Hide the overlay if nothing to warn about
    if (tabOverlayState[tabId]?.shown) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: "LIFECYCLE_OVERLAY_HIDE" });
      } catch (_) {}
      tabOverlayState[tabId] = { ...tabOverlayState[tabId], domain, shown: false };
    }
    return;
  }

  const state = tabOverlayState[tabId] || {};
  const now = Date.now();
  const sameThreshold = state.domain === domain && state.lastThresholdKey === thresholdKey;
  const recentlyShown = state.lastShownAt && now - state.lastShownAt < OVERLAY_COOLDOWN_MS;

  if (sameThreshold && recentlyShown) {
    return;
  }

  let line1 = "";
  let line2 = "";
  let level = "warn"; // "warn" | "danger"

  if (dailyThresholdKey) {
    const pct = avg > 0 ? Math.round(((domainMins - avg) / avg) * 100) : 0;
    line1 = `${displayDomain(domain)}: ${displayMinutes(domainMins)} min today (+${pct}% above avg)`;
    level = above150 ? "danger" : "warn";
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
    tabOverlayState[tabId] = { domain, shown: true, lastShownAt: now, lastThresholdKey: thresholdKey };
  } catch (_) {
    // Content script may not be injected yet — ignore silently
  }
}

async function syncTodayToBackend(options = {}) {
  const now = Date.now();
  const force = Boolean(options.force);
  const headers = await authHeaders();

  if (!headers) {
    return;
  }

  if (!force && now - lastBackendSyncAt < BACKEND_SYNC_MIN_INTERVAL_MS) {
    return;
  }

  const settings = await getSettings();
  const dateKey = localDateKey(now, settings.dailyResetHour);
  const { dailyUsage, trackedDays } = await getDailyUsage();
  const usage = dailyUsage[dateKey] || {};
  const backendUrl = await getBackendUrl();

  if (!trackedDays[dateKey]) {
    return;
  }

  const signature = JSON.stringify({ date: dateKey, usage });

  if (!force && signature === lastBackendSyncSignature) {
    lastBackendSyncAt = now;
    return;
  }

  try {
    const response = await fetch(`${backendUrl}/usage`, {
      method: "POST",
      headers,
      body: JSON.stringify({ date: dateKey, usage, tracked: true })
    });

    if (response.status === 401) {
      await clearAuthState("Session expired. Please sign in again.");
      return;
    }

    if (!response.ok) {
      throw new Error(`Backend sync failed with ${response.status}`);
    }

    lastBackendSyncAt = now;
    lastBackendSyncSignature = signature;
  } catch (_error) {
    lastBackendSyncAt = now;

    if (now - lastBackendSyncErrorLogAt >= BACKEND_SYNC_ERROR_LOG_INTERVAL_MS) {
      lastBackendSyncErrorLogAt = now;
      console.warn("LifeCycle backend sync failed; local tracking remains active");
    }
  }
}

async function pullFromBackend() {
  const headers = await authHeaders();

  if (!headers) {
    return;
  }

  try {
    const backendUrl = await getBackendUrl();
    const response = await fetch(`${backendUrl}/usage/history`, { headers });

    if (response.status === 401) {
      await clearAuthState("Session expired. Please sign in again.");
      return;
    }

    if (!response.ok) {
      throw new Error(`Backend pull failed with ${response.status}`);
    }

    const { history = {} } = await response.json();
    const settings = await getSettings();
    const todayKey = localDateKey(Date.now(), settings.dailyResetHour);
    const { dailyUsage, trackedDays } = await getDailyUsage();

    for (const [dateKey, usage] of Object.entries(history)) {
      if (dateKey === todayKey || trackedDays[dateKey]) {
        continue;
      }

      dailyUsage[dateKey] = usage;
      trackedDays[dateKey] = true;
    }

    pruneDailyHistory(dailyUsage, trackedDays, Date.now(), settings.dailyResetHour);
    await setDailyUsage(dailyUsage, trackedDays);
  } catch (_error) {
    // Server sync is optional; local storage remains the source of truth.
  }
}

async function startLogin() {
  const backendUrl = await getBackendUrl();
  await chrome.storage.local.set({ authError: "" });
  await chrome.tabs.create({ url: `${backendUrl}/login?source=extension` });
  return getAuthState();
}

async function signOut() {
  const headers = await authHeaders();

  if (headers) {
    try {
      const backendUrl = await getBackendUrl();
      await fetch(`${backendUrl}/auth/logout`, {
        method: "POST",
        headers
      });
    } catch (_error) {
      // Logging out locally is enough for a stateless bearer token.
    }
  }

  await clearAuthState();
  return getAuthState();
}

async function syncTaskSessionToBackend(sessionSummary) {
  const headers = await authHeaders();

  if (!headers || !sessionSummary) {
    return;
  }

  try {
    const backendUrl = await getBackendUrl();
    const response = await fetch(`${backendUrl}/task-sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        profileId: sessionSummary.profileId,
        profileName: sessionSummary.profileName,
        title: sessionSummary.title,
        group: sessionSummary.group,
        startedAt: new Date(sessionSummary.startedAt).toISOString(),
        endedAt: new Date(sessionSummary.endedAt).toISOString(),
        durationMinutes: sessionSummary.durationMinutes,
        allowedMinutes: sessionSummary.allowedMinutes,
        blockedMinutes: sessionSummary.blockedMinutes,
        idleMinutes: sessionSummary.idleMinutes,
        tabSwitches: sessionSummary.tabSwitches,
        blockedAttempts: sessionSummary.blockedAttempts,
        overrideCount: sessionSummary.overrideCount,
        qualityScore: sessionSummary.qualityScore,
        distractingDomainCounts: sessionSummary.distractingDomainCounts,
        overrideLog: sessionSummary.overrideLog
      })
    });

    if (response.status === 401) {
      await clearAuthState("Session expired. Please sign in again.");
    }
  } catch (_error) {
    // Task analytics remain available locally if backend sync fails.
  }
}

async function handleAuthCallback(tabId, rawUrl) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch (_error) {
    return false;
  }

  const backendUrl = await getBackendUrl();

  if (url.origin !== new URL(backendUrl).origin || url.pathname !== AUTH_CALLBACK_PATH) {
    return false;
  }

  const token = url.searchParams.get("token");
  const email = url.searchParams.get("email");
  const userId = url.searchParams.get("userId");

  if (!token) {
    return true;
  }

  await chrome.storage.local.set({
    authToken: token,
    authEmail: email || null,
    authUserId: userId || null,
    authError: ""
  });
  await pullFromBackend();
  await syncTodayToBackend({ force: true });

  try {
    await chrome.tabs.remove(tabId);
  } catch (_error) {
    // The tab may already be gone.
  }

  return true;
}

async function suggestTask(message) {
  return taskSuggestionForTitle(message.title || "");
}

async function startTaskSession(message) {
  const timestamp = Date.now();
  const profiles = await getTaskProfiles();
  const profile = profiles.find((item) => item.id === message.profileId) || null;
  const suggestion = taskSuggestionForTitle(message.title || "Focus session");
  const allowedDomains = normalizeAllowedDomains(
    message.allowedDomains && message.allowedDomains.length > 0
      ? message.allowedDomains
      : profile?.allowedDomains || suggestion.allowedDomains
  );
  const blockedDomains = normalizeAllowedDomains(
    message.blockedDomains && message.blockedDomains.length > 0
      ? message.blockedDomains
      : profile?.blockedDomains || suggestion.blockedDomains || []
  );
  const title = String(message.title || profile?.name || "Focus session").trim() || "Focus session";
  const taskSession = {
    id: `task-${timestamp}`,
    active: true,
    profileId: profile?.id || message.profileId || null,
    profileName: profile?.name || null,
    title,
    group: String(message.group || profile?.group || suggestion.group || "focus").trim() || "focus",
    allowedDomains,
    blockedDomains,
    defaultDuration: Math.max(5, Math.min(480, Number(message.defaultDuration || profile?.defaultDuration || suggestion.defaultDuration || 60))),
    startedAt: timestamp,
    lastCheckpointAt: timestamp,
    lastDomain: null,
    lastBlockedKey: null,
    metrics: emptyTaskMetrics(),
    distractingDomainCounts: emptyDistractingDomainCounts(),
    overrides: {},
    overrideLog: []
  };

  await setTaskSession(taskSession);
  await refreshActiveContext();
  return taskSnapshot(taskSession);
}

async function stopTaskSession() {
  const snapshot = await getFocusSnapshot();
  const taskSession = await checkpointTaskSession(snapshot, Date.now());

  if (taskSession) {
    const completedSession = taskSessionSummaryForHistory(taskSession, Date.now());
    const history = await getTaskSessionHistory();
    await chrome.storage.local.set({
      lastTaskSession: completedSession,
      taskSessionHistory: [...history, completedSession].slice(-500),
      taskSession: null
    });
    await syncTaskSessionToBackend(completedSession);
  }

  if (snapshot?.activeTab?.id) {
    await hideTaskBlocker(snapshot.activeTab.id);
  }

  return taskSnapshot(null);
}

async function taskOverrideCurrentTab(message, sender) {
  const timestamp = Date.now();
  const taskSession = await getTaskSession();
  const tabId = sender?.tab?.id || message.tabId;
  const domain = normalizeAllowedDomain(message.domain);

  if (!taskSession || !domain) {
    return taskSnapshot(taskSession);
  }

  const metrics = {
    ...emptyTaskMetrics(),
    ...(taskSession.metrics || {}),
    overrideCount: Number(taskSession.metrics?.overrideCount || 0) + 1
  };
  const overrideEntry = {
    domain,
    attemptedAt: timestamp,
    expiresAt: timestamp + TASK_OVERRIDE_DURATION_MS
  };
  const nextTaskSession = {
    ...taskSession,
    metrics,
    overrides: {
      ...(taskSession.overrides || {}),
      [domain]: overrideEntry
    },
    overrideLog: [
      ...(taskSession.overrideLog || []),
      {
        domain,
        reason: String(message.reason || "emergency_override").slice(0, 120),
        at: timestamp
      }
    ].slice(-100)
  };

  await setTaskSession(nextTaskSession);
  await hideTaskBlocker(tabId);
  return taskSnapshot(nextTaskSession);
}

async function saveTaskProfileFromMessage(message) {
  return saveTaskProfile({
    id: message.profile?.id,
    name: message.profile?.name,
    group: message.profile?.group,
    allowedDomains: message.profile?.allowedDomains,
    blockedDomains: message.profile?.blockedDomains,
    defaultDuration: message.profile?.defaultDuration
  });
}

async function deleteTaskProfileFromMessage(message) {
  return deleteTaskProfile(message.profileId);
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
  await syncTodayToBackend({ force: true });
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
  enqueue(async () => {
    await migrateStorage();
    await pullFromBackend();
    await refreshActiveContext();
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  chrome.alarms.create("lifecycle-checkpoint", { periodInMinutes: 1 });
  enqueue(async () => {
    await migrateStorage();
    await pullFromBackend();
    await refreshActiveContext();
  });
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) {
    return;
  }

  enqueue(async () => {
    if (await handleAuthCallback(tabId, changeInfo.url)) {
      return;
    }

    if (tab.active) {
      await refreshActiveContext();
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabOverlayState[tabId]) {
    delete tabOverlayState[tabId];
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
      return buildSummary();
    },
    PAUSE_TRACKING: pauseTrackingManually,
    RESUME_TRACKING: resumeTrackingManually,
    EXCLUDE_CURRENT_SITE: excludeCurrentSite,
    RESET_TODAY: resetTodaysData,
    CLEAR_ALL_DATA: clearAllData,
    SET_CURRENT_SITE_CATEGORY: async () => setCurrentSiteCategory(message.category),
    GET_AUTH_STATE: getAuthState,
    START_LOGIN: startLogin,
    SIGN_OUT: signOut,
    SUGGEST_TASK: suggestTask,
    START_TASK_SESSION: startTaskSession,
    STOP_TASK_SESSION: stopTaskSession,
    TASK_EMERGENCY_OVERRIDE: taskOverrideCurrentTab,
    SAVE_TASK_PROFILE: saveTaskProfileFromMessage,
    DELETE_TASK_PROFILE: deleteTaskProfileFromMessage
  };

  const handler = handlers[message?.type];

  if (!handler) {
    return false;
  }

  enqueue(async () => {
    try {
      const summary = await handler(message, _sender);
      sendResponse(summary);
    } catch (error) {
      console.error("LifeCycle message failed", error);
      sendResponse(null);
    }
  });

  return true;
});
