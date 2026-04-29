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

const domFavicon        = $("favicon");
const domDomainName     = $("domain-name");
const domStatusBadge    = $("status-badge");
const domStatToday      = $("stat-today");
const domStatAvg        = $("stat-avg");
const domStatAvgLbl     = $("stat-avg-lbl");
const domStatPredicted  = $("stat-predicted");
const domSessionSection = $("session-section");
const domSessionMeta    = $("session-meta");
const domSessionFill    = $("session-fill");
const domSessionCaption = $("session-caption");
const domRecommendation = $("recommendation");
const domSitesList      = $("sites-list");
const domConfidence     = $("confidence-row");
const domResetSelect    = $("reset-select");

/* ── Reset setting ───────────────────────── */

// Load saved reset hour and map 0→midnight, 3→3am
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

/* ── Confidence dots ─────────────────────── */

function renderConfidence(label) {
  // label: "Low confidence", "Medium confidence", "High confidence", or "-"/null
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

/* ── Map background summary → UI ─────────── */

/*
  buildSummary() (from background.js) returns a flat object. Key fields:
    domain                  – active/current domain (string | null)
    usage                   – { [domain]: minutes } for today
    averageMinutes          – baseline avg for the active domain (number | "-")
    status                  – e.g. "+18% above normal" | "On your normal pace"
    prediction              – e.g. "Prediction: ~42 min today"
    recommendation          – advice string
    todayMinutes            – minutes on active domain today
    currentSessionMinutes   – current session length (number | "-")
    typicalSessionMinutes   – median past session (number | "-")
    sessionPercentile       – 0-100 | null
    sessionStatus           – "Active" | "Paused" | "No active tab" | …
    baselineConfidence      – "High confidence" | "Medium confidence" | "Low confidence" | "-"
    elapsedMinutesToday     – minutes since midnight/reset (number)
*/

function render(raw) {
  if (!raw) return;

  const domain = raw.domain || null;
  const usageToday = raw.usage || {};
  const domainMins = domain ? Number(usageToday[domain] || 0) : null;

  /* ── Top bar ── */
  setFavicon(domain);
  domDomainName.textContent = domain || "No active tab";

  const statusStr = raw.status || "";
  if (domain && statusStr && statusStr !== "-") {
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

  // Extract the predicted minutes from e.g. "Prediction: ~42 min today"
  const predStr = raw.prediction || "";
  const predMatch = predStr.match(/~(\d+)/);
  domStatPredicted.textContent = predMatch ? "~" + fmt(Number(predMatch[1])) : "—";

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
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_USAGE_SUMMARY" });
    if (response) render(response);
  } catch (e) {
    // background not ready yet — skip
  }
}

refresh();
setInterval(refresh, 1000);
