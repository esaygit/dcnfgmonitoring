export function clean(value: string | undefined | null) { return (value ?? "").replace(/\s+/g, " ").trim(); }
export function matched(text: string, pattern: RegExp) { return clean(text.match(pattern)?.[1]); }
export const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Returns YYYY-MM-DD, or "" when the value is not a real calendar date. */
export function normalizedDate(value: string, monthFirst = true) {
  const date = value.trim();
  const iso = date.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|T)/);
  const dayFirst = date.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
  const parts = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : dayFirst
      ? [Number(dayFirst[3].length === 2 ? `20${dayFirst[3]}` : dayFirst[3]), Number(monthFirst ? dayFirst[1] : dayFirst[2]), Number(monthFirst ? dayFirst[2] : dayFirst[1])]
      : [];
  if (parts.length !== 3) return "";
  const [year, month, day] = parts;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
export function isoDate(value: string) { return normalizedDate(value); }
/** MM-DD-YYYY, the format used across the UI. */
export function displayDate(value: string, monthFirst = true) {
  const [year, month, day] = normalizedDate(value, monthFirst).split("-");
  return year ? `${month}-${day}-${year}` : "";
}

/** Returns HH:MM:SS (24-hour), or "" when the value is not a valid time. Accepts "14:32", "14:32:10" and "2:05 PM". */
export function normalizedTime(value: string) {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (!m) return "";
  let hour = Number(m[1]);
  if (m[4]) { const pm = m[4].toUpperCase() === "PM"; hour = (hour % 12) + (pm ? 12 : 0); }
  if (hour > 23 || Number(m[2]) > 59) return "";
  return `${String(hour).padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
}

export const fmt = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
export const pct = (part: number, whole: number) => whole > 0 ? `${(part / whole * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : "0%";

export function transactionReferences(values: string[]) { return [...new Set(values.map((value) => clean(value) || "not entered"))].join(", "); }

export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
