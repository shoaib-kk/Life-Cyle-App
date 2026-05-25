export function fmtMinutes(minutes: number | null | undefined) {
  const numeric = Number(minutes);
  const value = Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
  if (value < 60) {
    return `${value}m`;
  }
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function fmtScore(score: number | null | undefined) {
  return score == null ? "-" : `${score}`;
}

export function hourLabel(hour: number) {
  const suffix = hour >= 12 ? "pm" : "am";
  const value = hour % 12 || 12;
  return `${value}${suffix}`;
}

export function shortDate(value: string) {
  return value.slice(5);
}
