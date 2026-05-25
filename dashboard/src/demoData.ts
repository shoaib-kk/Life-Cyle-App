import type { DashboardData } from "./types";

const daily = [
  245, 310, 280, 415, 360, 190, 155, 330, 390, 420, 300, 260, 180, 140,
  355, 410, 465, 380, 295, 210, 165, 370, 450, 485, 405, 320, 230, 175,
  395, 430
].map((minutes, index) => {
  const date = new Date();
  date.setDate(date.getDate() - (29 - index));
  return { date: date.toISOString().slice(0, 10), minutes };
});

const weekly = [
  { weekStart: "2026-05-04", minutes: 2110 },
  { weekStart: "2026-05-11", minutes: 2385 },
  { weekStart: "2026-05-18", minutes: 2440 }
];

const hourlyHeatmap = Array.from({ length: 7 * 24 }, (_, index) => {
  const weekday = Math.floor(index / 24);
  const hour = index % 24;
  const workWindow = hour >= 9 && hour <= 17 && weekday < 5;
  const lateWindow = hour >= 20 && hour <= 23;
  const minutes = workWindow ? 28 + ((hour + weekday) % 5) * 6 : lateWindow ? 12 : 2;
  const productiveMinutes = workWindow ? Math.round(minutes * 0.72) : lateWindow ? 2 : 1;
  return { weekday, hour, minutes, productiveMinutes };
});

export const demoData: DashboardData = {
  demoMode: true,
  summary: {
    hasData: true,
    score: 78,
    scoreDelta: 6,
    today: {
      productiveMinutes: 214,
      distractingMinutes: 48,
      neutralMinutes: 35,
      totalMinutes: 297,
      productiveRatio: 72,
      distractingRatio: 16
    },
    totals: {
      productiveMinutes: 2330,
      distractingMinutes: 520,
      neutralMinutes: 410,
      totalMinutes: 3260,
      productiveRatio: 71,
      distractingRatio: 16
    },
    topDomains: [
      { domain: "github.com", minutes: 720, percentage: 22.1, category: "development", productivity: "productive", sessionCount: 38, averageSessionMinutes: 19 },
      { domain: "docs.google.com", minutes: 510, percentage: 15.6, category: "documents", productivity: "productive", sessionCount: 26, averageSessionMinutes: 20 },
      { domain: "linkedin.com", minutes: 360, percentage: 11, category: "career", productivity: "productive", sessionCount: 18, averageSessionMinutes: 20 },
      { domain: "youtube.com", minutes: 320, percentage: 9.8, category: "video", productivity: "distracting", sessionCount: 22, averageSessionMinutes: 15 },
      { domain: "reddit.com", minutes: 190, percentage: 5.8, category: "social", productivity: "distracting", sessionCount: 17, averageSessionMinutes: 11 }
    ],
    contextSwitchCount: 64,
    longestFocusStreakMinutes: 96,
    focusSessionCount: 18,
    focusDecay: { delta: -5.5, label: "Focus quality is broadly stable" },
    mostProductiveHours: [
      { hour: 10, minutes: 420 },
      { hour: 14, minutes: 390 },
      { hour: 16, minutes: 330 }
    ],
    generatedAt: new Date().toISOString()
  },
  timeSeries: {
    daily,
    weekly,
    hourlyHeatmap
  },
  domains: {
    domains: [
      { domain: "github.com", minutes: 720, percentage: 22.1, category: "development", productivity: "productive", sessionCount: 38, averageSessionMinutes: 19 },
      { domain: "docs.google.com", minutes: 510, percentage: 15.6, category: "documents", productivity: "productive", sessionCount: 26, averageSessionMinutes: 20 },
      { domain: "linkedin.com", minutes: 360, percentage: 11, category: "career", productivity: "productive", sessionCount: 18, averageSessionMinutes: 20 },
      { domain: "youtube.com", minutes: 320, percentage: 9.8, category: "video", productivity: "distracting", sessionCount: 22, averageSessionMinutes: 15 },
      { domain: "reddit.com", minutes: 190, percentage: 5.8, category: "social", productivity: "distracting", sessionCount: 17, averageSessionMinutes: 11 },
      { domain: "gmail.com", minutes: 155, percentage: 4.8, category: "communication", productivity: "neutral", sessionCount: 13, averageSessionMinutes: 12 }
    ],
    categoryTotals: {
      productiveMinutes: 2330,
      distractingMinutes: 520,
      neutralMinutes: 410,
      totalMinutes: 3260,
      productiveRatio: 71,
      distractingRatio: 16
    }
  },
  profiles: {
    profiles: [
      {
        profileId: "coding",
        profileName: "Coding",
        group: "coding",
        totalFocusMinutes: 840,
        blockedMinutes: 92,
        sessionCount: 9,
        blockedAttempts: 14,
        overrideCount: 2,
        averageQuality: 84,
        leakageRate: 9.9,
        mostDistractingDomains: [{ domain: "youtube.com", count: 8 }, { domain: "reddit.com", count: 6 }]
      },
      {
        profileId: "study",
        profileName: "Studying",
        group: "study",
        totalFocusMinutes: 610,
        blockedMinutes: 74,
        sessionCount: 6,
        blockedAttempts: 11,
        overrideCount: 1,
        averageQuality: 81,
        leakageRate: 10.8,
        mostDistractingDomains: [{ domain: "instagram.com", count: 5 }, { domain: "youtube.com", count: 4 }]
      },
      {
        profileId: "job-hunting",
        profileName: "Job Hunting",
        group: "career",
        totalFocusMinutes: 355,
        blockedMinutes: 28,
        sessionCount: 3,
        blockedAttempts: 4,
        overrideCount: 0,
        averageQuality: 88,
        leakageRate: 7.3,
        mostDistractingDomains: [{ domain: "reddit.com", count: 3 }]
      }
    ],
    focusLengthDistribution: [
      { bucket: "0-15", sessions: 2 },
      { bucket: "15-30", sessions: 4 },
      { bucket: "30-60", sessions: 5 },
      { bucket: "60-120", sessions: 6 },
      { bucket: "120+", sessions: 1 }
    ],
    focusDecay: { delta: -5.5, label: "Focus quality is broadly stable" }
  },
  focus: {
    distribution: [
      { bucket: "0-15", sessions: 2 },
      { bucket: "15-30", sessions: 4 },
      { bucket: "30-60", sessions: 5 },
      { bucket: "60-120", sessions: 6 },
      { bucket: "120+", sessions: 1 }
    ],
    qualityTrend: [
      { date: "2026-05-16", profileName: "Coding", qualityScore: 88, durationMinutes: 92 },
      { date: "2026-05-17", profileName: "Studying", qualityScore: 78, durationMinutes: 64 },
      { date: "2026-05-18", profileName: "Coding", qualityScore: 86, durationMinutes: 105 },
      { date: "2026-05-19", profileName: "Job Hunting", qualityScore: 91, durationMinutes: 70 },
      { date: "2026-05-20", profileName: "Coding", qualityScore: 82, durationMinutes: 86 },
      { date: "2026-05-21", profileName: "Studying", qualityScore: 80, durationMinutes: 74 }
    ],
    averageQuality: 84
  },
  goals: [
    { id: 1, metric: "productive_time", targetMinutes: 1200, period: "weekly", active: true },
    { id: 2, metric: "distracting_time", targetMinutes: 300, period: "weekly", active: true },
    { id: 3, metric: "coding_focus", targetMinutes: 480, period: "weekly", profileId: "coding", active: true }
  ],
  weeklyReport: {
    generatedAt: new Date().toISOString(),
    narrative: "71% of categorized time was productive with 64 context switches.",
    metrics: {
      weekStart: "2026-05-18",
      weekEnd: "2026-05-24",
      totalMinutes: 2440,
      productiveMinutes: 1740,
      distractingMinutes: 380,
      productivityScore: 78,
      contextSwitchCount: 64,
      longestFocusStreakMinutes: 96,
      topDomains: [
        { domain: "github.com", minutes: 430, percentage: 17.6, category: "development", productivity: "productive" },
        { domain: "docs.google.com", minutes: 320, percentage: 13.1, category: "documents", productivity: "productive" },
        { domain: "youtube.com", minutes: 210, percentage: 8.6, category: "video", productivity: "distracting" }
      ],
      mostProductiveHours: [
        { hour: 10, minutes: 420 },
        { hour: 14, minutes: 390 },
        { hour: 16, minutes: 330 }
      ],
      focusDecay: { delta: -5.5, label: "Focus quality is broadly stable" },
      profiles: []
    }
  }
};
