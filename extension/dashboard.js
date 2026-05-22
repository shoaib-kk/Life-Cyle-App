"use strict";

const $ = (id) => document.getElementById(id);

function fmtMinutes(minutes) {
  const value = Math.round(Number(minutes || 0));
  if (value < 60) {
    return `${value}m`;
  }
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function renderWeeklyChart(items) {
  const maxMinutes = Math.max(...items.map((item) => item.minutes), 1);
  $("weekly-chart").innerHTML = items.map((item) => {
    const height = Math.max(4, Math.round((item.minutes / maxMinutes) * 120));
    const label = item.date.slice(5);
    return `
      <div class="bar-item">
        <div class="muted">${fmtMinutes(item.minutes)}</div>
        <div class="bar" style="height:${height}px"></div>
        <div>${label}</div>
      </div>
    `;
  }).join("");
}

function renderQualityTrend(items) {
  if (!items.length) {
    $("quality-trend").innerHTML = '<div class="muted">No completed sessions yet.</div>';
    return;
  }

  $("quality-trend").innerHTML = items.map((item) => `
    <div class="row">
      <span>${item.profileName}</span>
      <span class="muted">${item.date} · ${item.score}/100</span>
    </div>
  `).join("");
}

function renderTaskBreakdown(items) {
  if (!items.length) {
    $("task-breakdown").innerHTML = '<div class="muted">No task history yet.</div>';
    return;
  }

  $("task-breakdown").innerHTML = items.map((item) => `
    <div class="row">
      <span>${item.profileName}</span>
      <span class="muted">${fmtMinutes(item.minutes)} · ${item.averageSessionQuality ?? "-"} avg</span>
    </div>
  `).join("");
}

function renderDistractions(items) {
  const rows = items
    .filter((item) => item.distractions.length > 0)
    .map((item) => {
      const text = item.distractions.map((entry) => `${entry.domain} (${entry.count})`).join(", ");
      return `
        <div class="row">
          <span>${item.profileName}</span>
          <span class="muted">${text}</span>
        </div>
      `;
    });

  $("distractions").innerHTML = rows.length
    ? rows.join("")
    : '<div class="muted">No blocked attempts yet.</div>';
}

async function refresh() {
  const data = await chrome.runtime.sendMessage({ type: "GET_TASK_DASHBOARD" });
  const weeklyTotal = (data.weeklyFocusTrend || []).reduce((sum, item) => sum + Number(item.minutes || 0), 0);
  const qualityScores = (data.qualityTrend || []).map((item) => Number(item.score || 0));
  const avgQuality = qualityScores.length
    ? Math.round(qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length)
    : null;

  $("today-focus").textContent = fmtMinutes(data.todayFocusMinutes || 0);
  $("week-focus").textContent = fmtMinutes(weeklyTotal);
  $("avg-quality").textContent = avgQuality === null ? "-" : `${avgQuality}/100`;
  renderWeeklyChart(data.weeklyFocusTrend || []);
  renderQualityTrend(data.qualityTrend || []);
  renderTaskBreakdown(data.taskBreakdown || []);
  renderDistractions(data.distractionsByProfile || []);
}

$("refresh-btn").addEventListener("click", refresh);
refresh();
