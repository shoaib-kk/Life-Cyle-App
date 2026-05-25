export type Productivity = "productive" | "distracting" | "neutral";

export type CategoryTotals = {
  productiveMinutes: number;
  distractingMinutes: number;
  neutralMinutes: number;
  totalMinutes: number;
  productiveRatio: number;
  distractingRatio: number;
};

export type DomainMetric = {
  domain: string;
  minutes: number;
  percentage: number;
  category: string;
  productivity: Productivity;
  sessionCount?: number;
  averageSessionMinutes?: number | null;
};

export type DashboardSummary = {
  hasData: boolean;
  score: number | null;
  scoreDelta: number | null;
  today: CategoryTotals;
  totals: CategoryTotals;
  topDomains: DomainMetric[];
  contextSwitchCount: number;
  longestFocusStreakMinutes: number;
  focusSessionCount: number;
  focusDecay: {
    delta: number;
    label: string;
  };
  mostProductiveHours: Array<{ hour: number; minutes: number }>;
  generatedAt: string;
};

export type TimeSeriesData = {
  daily: Array<{ date: string; minutes: number }>;
  weekly: Array<{ weekStart: string; minutes: number }>;
  hourlyHeatmap: Array<{
    weekday: number;
    hour: number;
    minutes: number;
    productiveMinutes: number;
  }>;
};

export type ProfileMetric = {
  profileId: string;
  profileName: string;
  group: string;
  totalFocusMinutes: number;
  blockedMinutes: number;
  sessionCount: number;
  blockedAttempts: number;
  overrideCount: number;
  averageQuality: number | null;
  leakageRate: number;
  mostDistractingDomains: Array<{ domain: string; count: number }>;
};

export type ProfileAnalytics = {
  profiles: ProfileMetric[];
  focusLengthDistribution: Array<{ bucket: string; sessions: number }>;
  focusDecay: {
    delta: number;
    label: string;
  };
};

export type FocusAnalytics = {
  distribution: Array<{ bucket: string; sessions: number }>;
  qualityTrend: Array<{
    date: string;
    profileName: string;
    qualityScore: number;
    durationMinutes: number;
  }>;
  averageQuality: number | null;
};

export type Goal = {
  id: number;
  metric: string;
  targetMinutes: number;
  period: string;
  profileId?: string | null;
  domain?: string | null;
  active: boolean;
};

export type WeeklyReport = {
  generatedAt: string;
  narrative: string;
  metrics: {
    weekStart: string;
    weekEnd: string;
    totalMinutes: number;
    productiveMinutes: number;
    distractingMinutes: number;
    productivityScore: number | null;
    contextSwitchCount: number;
    longestFocusStreakMinutes: number;
    topDomains: DomainMetric[];
    mostProductiveHours: Array<{ hour: number; minutes: number }>;
    focusDecay: {
      delta: number;
      label: string;
    };
    profiles: ProfileMetric[];
  };
};

export type DashboardData = {
  demoMode: boolean;
  summary: DashboardSummary;
  timeSeries: TimeSeriesData;
  domains: {
    domains: DomainMetric[];
    categoryTotals: CategoryTotals;
  };
  profiles: ProfileAnalytics;
  focus: FocusAnalytics;
  goals: Goal[];
  weeklyReport: WeeklyReport;
};
