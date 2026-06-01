export function round(value) {
  return Math.round(Number(value || 0));
}

export function formatMinutes(minutes) {
  const value = round(minutes);
  if (value < 60) {
    return `${value}m`;
  }
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

export function formatGoalAmount(value, unit = "minutes") {
  if (unit === "blocks") {
    return `${round(value)} blocks`;
  }
  return formatMinutes(value);
}

export function greetingFor(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function emptyDashboardData() {
  return {
    intention: null,
    today: {
      dateLabel: new Date().toLocaleDateString("en-AU", {
        weekday: "long",
        day: "numeric",
        month: "long"
      }),
      currentMode: null,
      arc: { focusedMinutes: 0, distractedMinutes: 0, segments: [] },
      nudge: "",
      sites: [],
      split: { focused: 0, distracted: 0, idle: 0 },
      insight: ""
    },
    profiles: {
      coding: null,
      studying: null,
      entertainment: null
    },
    week: {
      range: "",
      averageMinutes: 0,
      days: [],
      stats: { total: "0m", bestDay: "-", goalsHit: "0 of 0" },
      sites: []
    },
    goals: []
  };
}
