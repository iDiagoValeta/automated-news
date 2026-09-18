export function addDays(ymd: string, delta: number): string;
export function buildWeek(
  editions: Array<Record<string, unknown>>,
  days?: number,
): {
  from: string | null;
  to: string | null;
  editions: Array<Record<string, unknown>>;
  tops: Array<{ date: string; path: string; item: Record<string, unknown> }>;
  categories: Array<{ id: string; label: string; count: number }>;
  repos: Array<Record<string, unknown> & { name: string }>;
};
