/* ─────────────────────────────────────────────
   LifeCycle popup.js — redesigned UI renderer
   Reads from chrome.storage.local + background
   and populates the new layout every second.
───────────────────────────────────────────── */

"use strict";

/* ── Helpers ─────────────────────────────── */

function fmt(minutes) {
  if (minutes == null || isNaN(minutes)) return "—";
  const m = Math.round(minutes);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? h + "h" : h + "h " + rem + "m";
}

function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function weekdayName(date) {
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

/* ── DOM refs ────────────────────────────── */

const $ = id => document.getElementById(id);

const domFavicon       = $("favicon");
const domDomainName    = $("domain-name");
const domStatusBadge   = $("status-badge");
const domStatToday     = $("stat-today");
const domStatAvg       = $("stat-avg");
const domStatAvgLbl    = $("stat-avg-lbl");
const domStatPredicted = $("stat-predicted");
const domSessionSection= $("session-section");
const domSessionMeta   = $("session-meta");
const domSessionFill   = $("session-fill");
const domSessionCaption= $("session-caption");
const domRecommendation= $("recommendation");
const domSitesList     = $("sites-list");
const domConfidence    = $("confidence-row");
const domResetSelect   = $("reset-select");

/* ── Reset setting ───────────────────────── */

chrome.storage.local.get("resetTime", ({ resetTime }) => {
  domResetSelect.value = resetTime || "midnight";
});

domResetSelect.addEventListener("change", () => {
  chrome.storage.local.set({ resetTime: domResetSelect.value });
  // notify background to apply new boundary
  chrome.runtime.sendMessage({ type: "resetTimeChanged", value: domResetSelect.value });
});

/* ── Confidence dots ─────────────────────── */

function renderConfidence(level) {
  // level: "low" (1-2), "medium" (3-5), "high" (6+), or null
  const filled = level === "high" ? 4 : level === "medium" ? 3 : level === "low" ? 2 : 0;
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

  // Try to load real favicon via Google's service
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

function renderSites(summary, activeDomain) {
  if (!summary || !summary.usage || Object.keys(summary.usage).length === 0) {
    domSitesList.innerHTML = '<div class="no-data">No sites tracked today</div>';
    return;
  }

  const sorted = Object.entries(summary.usage)
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

function render(data) {
  const {
    activeDomain,
    isIdle,
    sessionStart,
    summary,        // { usage: {domain: mins}, ...}
    insight,        // from background/backend: { today, baseline, predicted, delta, status, recommendation, confidence }
    sessionInsight, // { currentSession, typicalSession, percentile, status }
  } = data;

  const todayKey = today();
  const todayUsage = summary?.usage || {};
  const domainMins = activeDomain ? (todayUsage[activeDomain] || 0) : null;

  /* ── Top bar ── */
  if (activeDomain) {
    setFavicon(activeDomain);
    domDomainName.textContent = activeDomain;
  } else {
    setFavicon(null);
    domDomainName.textContent = "No active tab";
  }

  /* status badge from insight delta */
  if (insight && insight.status && activeDomain) {
    const delta = insight.delta; // e.g. 0.18 = +18%
    if (delta == null) {
      setBadge("", "muted");
    } else {
      const sign = delta >= 0 ? "+" : "";
      const pct = Math.round(Math.abs(delta) * 100);
      if (Math.abs(delta) < 0.05) {
        setBadge("On pace", "ok");
      } else if (delta > 0) {
        setBadge(`+${pct}% above avg`, "warn");
      } else {
        setBadge(`${pct}% below avg`, "ok");
      }
    }
  } else if (activeDomain) {
    setBadge("", "muted");
  } else {
    setBadge("", "");
  }

  /* ── Stat grid ── */
  domStatToday.textContent = activeDomain ? fmt(domainMins) : "—";

  if (insight && insight.baseline != null) {
    domStatAvg.textContent = fmt(insight.baseline);
    const d = new Date();
    domStatAvgLbl.textContent = "Avg (" + weekdayName(d) + ")";
  } else {
    domStatAvg.textContent = "—";
    domStatAvgLbl.textContent = "Avg";
  }

  if (insight && insight.predicted != null) {
    domStatPredicted.textContent = "~" + fmt(insight.predicted);
  } else {
    domStatPredicted.textContent = "—";
  }

  /* ── Session bar ── */
  if (sessionInsight && activeDomain) {
    const cur = sessionInsight.currentSession;
    const typ = sessionInsight.typicalSession;

    domSessionMeta.textContent = typ != null
      ? fmt(cur) + " · typical " + fmt(typ)
      : fmt(cur);

    if (isIdle) {
      domSessionCaption.textContent = "Paused — idle";
      setProgressBar(typ != null ? (cur / typ) * 100 : 50, "muted");
    } else if (typ != null) {
      const ratio = cur / typ;
      const cls = ratio > 1.3 ? "danger" : ratio > 1 ? "warn" : "ok";
      setProgressBar(Math.min(ratio * 100, 100), cls);

      if (sessionInsight.percentile != null) {
        const p = Math.round(sessionInsight.percentile * 100);
        domSessionCaption.textContent = `Longer than ${p}% of your past sessions`;
      } else {
        domSessionCaption.textContent = "";
      }
    } else {
      setProgressBar(50, "muted");
      domSessionCaption.textContent = "Not enough history yet";
    }

    domSessionSection.style.display = "";
  } else if (!activeDomain) {
    domSessionSection.style.display = "none";
  } else {
    domSessionSection.style.display = "";
    domSessionMeta.textContent = "—";
    setProgressBar(0, "muted");
    domSessionCaption.textContent = "";
  }

  /* ── Recommendation ── */
  if (insight && insight.recommendation && activeDomain) {
    domRecommendation.textContent = insight.recommendation;
  } else {
    domRecommendation.textContent = "";
  }

  /* ── Sites ── */
  renderSites(summary, activeDomain);

  /* ── Confidence ── */
  renderConfidence(insight?.confidence || null);
}

/* ── Poll background every second ───────── */

async function refresh() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "getState" });
    if (response) render(response);
  } catch (e) {
    // background not ready yet — skip
  }
}

refresh();
setInterval(refresh, 1000);
