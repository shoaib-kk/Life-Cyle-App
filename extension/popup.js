function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function formatMinutes(minutes) {
  if (typeof minutes === "number") {
    return `${Math.round(minutes)} min`;
  }

  return String(minutes || "-");
}

function usageEntries(summary) {
  return Object.entries(summary.usage || {})
    .map(([domain, minutes]) => [domain, Number(minutes || 0)])
    .filter(([, minutes]) => minutes > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5);
}

function renderLeaderboard(summary) {
  const list = document.getElementById("siteLeaderboard");
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

function setMinutes(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = formatMinutes(value);
}

function setOptionalText(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
  el.hidden = !text;
}

function render(summary) {
  const domainLabel = summary.domain || "No domain tracked yet";
  const resetTime = document.getElementById("resetTime");

  setText("domain", domainLabel);
  resetTime.value = String(summary.settings?.dailyResetHour || 0);
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
  renderLeaderboard(summary);
}

function saveSettings() {
  const dailyResetHour = Number(document.getElementById("resetTime").value);

  chrome.runtime.sendMessage(
    {
      type: "SAVE_SETTINGS",
      settings: { dailyResetHour }
    },
    (summary) => {
      if (!chrome.runtime.lastError && summary) {
        render(summary);
      }
    }
  );
}

function fallbackSummary() {
  return {
    domain: null,
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
    usage: {}
  };
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

refreshSummary();
const refreshTimer = setInterval(refreshSummary, 1000);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearInterval(refreshTimer);
  }
});

document.getElementById("resetTime").addEventListener("change", saveSettings);
