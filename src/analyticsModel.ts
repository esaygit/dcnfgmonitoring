import { canonicalItemCode, groupForItemCode, ITEM_SEGMENTS } from "./constants";
import type { Transfer } from "./types";
import { normalizedDate } from "./utils";

export type AnalyticsInterval = "day" | "week" | "month";

export type AnalyticsBucket = {
  key: string;
  label: string;
  exports10: number;
  downgraded10: number;
  exports50: number;
  downgraded50: number;
  ppm10: number;
  ppm50: number;
  itemQuantities: Record<string, number>;
};

export type QualitySummary = {
  missingItemCode: number;
  unlistedItemCodes: { itemCode: string; records: number }[];
  duplicateRecords: number;
  duplicatesByWeek: { week: string; records: number }[];
};

export type MixSeries = { itemCode: string; values: number[] };

const DAY_MS = 24 * 60 * 60 * 1000;

export function bucketStart(value: string, interval: AnalyticsInterval) {
  const date = normalizedDate(value);
  if (!date) return "";
  const start = new Date(`${date}T00:00:00Z`);
  if (interval === "week") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (interval === "month") start.setUTCDate(1);
  return start.toISOString().slice(0, 10);
}

export function bucketRange(key: string, interval: AnalyticsInterval, selectedFrom = "", selectedTo = "") {
  const start = bucketStart(key, interval);
  if (!start) return null;
  const endDate = new Date(`${start}T00:00:00Z`);
  if (interval === "week") endDate.setUTCDate(endDate.getUTCDate() + 6);
  if (interval === "month") {
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);
    endDate.setUTCDate(0);
  }
  const end = endDate.toISOString().slice(0, 10);
  const from = normalizedDate(selectedFrom), to = normalizedDate(selectedTo);
  return {
    from: from && from > start ? from : start,
    to: to && to < end ? to : end,
  };
}

export function analyticsRecordsHref(from: string, to: string, item = "") {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (item) params.set("item", item);
  return `#/records?${params.toString()}`;
}

function labelFor(key: string, interval: AnalyticsInterval) {
  const date = new Date(`${key}T00:00:00Z`);
  if (interval === "day") return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  if (interval === "week") return `Week of ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(date)}`;
  return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function buildBuckets(records: Transfer[], from: string, to: string, interval: AnalyticsInterval): AnalyticsBucket[] {
  const dates = records.map((record) => normalizedDate(record.document_date)).filter(Boolean).sort();
  const start = normalizedDate(from) || dates[0] || "";
  const end = normalizedDate(to) || dates[dates.length - 1] || "";
  if (!start || !end || start > end) return [];

  const buckets = new Map<string, AnalyticsBucket>();
  const first = bucketStart(start, interval), last = bucketStart(end, interval);
  const cursor = new Date(`${first}T00:00:00Z`);
  const final = new Date(`${last}T00:00:00Z`);
  while (cursor <= final) {
    const key = cursor.toISOString().slice(0, 10);
    buckets.set(key, { key, label: labelFor(key, interval), exports10: 0, downgraded10: 0, exports50: 0, downgraded50: 0, ppm10: 0, ppm50: 0, itemQuantities: {} });
    if (interval === "day") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (interval === "week") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  for (const record of records) {
    const key = bucketStart(record.document_date, interval), bucket = buckets.get(key);
    if (!bucket) continue;
    const code = canonicalItemCode(record.item_code), quantity = Number(record.quantity);
    if (!Number.isFinite(quantity) || !code) continue;
    bucket.itemQuantities[code] = (bucket.itemQuantities[code] ?? 0) + quantity;
    const group = groupForItemCode(code);
    if (group === "10 PPM") bucket.ppm10 += quantity;
    if (group === "50 PPM") bucket.ppm50 += quantity;
    const segment = ITEM_SEGMENTS.find((entry) => entry.codes.some((candidate) => candidate === code));
    if (segment?.group === "10 PPM" && segment.segment === "exports") bucket.exports10 += quantity;
    if (segment?.group === "10 PPM" && segment.segment === "downgraded") bucket.downgraded10 += quantity;
    if (segment?.group === "50 PPM" && segment.segment === "exports") bucket.exports50 += quantity;
    if (segment?.group === "50 PPM" && segment.segment === "downgraded") bucket.downgraded50 += quantity;
  }
  return [...buckets.values()];
}

export function buildMixSeries(buckets: AnalyticsBucket[], group: string): MixSeries[] {
  const items = ITEM_SEGMENTS.filter((entry) => entry.group === group).flatMap(({ codes }) => codes);
  return items
    .map((itemCode) => ({
      itemCode,
      values: buckets.map((bucket) => {
        const total = items.reduce((sum, code) => sum + (bucket.itemQuantities[code] ?? 0), 0);
        return total ? (bucket.itemQuantities[itemCode] ?? 0) / total * 100 : 0;
      }),
    }))
    .filter((series) => series.values.some((value) => value > 0));
}

export function comparisonRange(from: string, to: string) {
  const start = normalizedDate(from), end = normalizedDate(to);
  if (!start || !end || start > end) return null;
  const startTime = Date.parse(`${start}T00:00:00Z`), endTime = Date.parse(`${end}T00:00:00Z`);
  const dayCount = Math.round((endTime - startTime) / DAY_MS) + 1;
  const previousEnd = new Date(startTime - DAY_MS);
  const previousStart = new Date(startTime - dayCount * DAY_MS);
  return { from: previousStart.toISOString().slice(0, 10), to: previousEnd.toISOString().slice(0, 10) };
}

export function percentChange(current: number, previous: number) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function summarizeQuality(records: Transfer[]): QualitySummary {
  const unlisted = new Map<string, number>(), duplicates = new Map<string, number>();
  let missingItemCode = 0, duplicateRecords = 0;
  for (const record of records) {
    const code = canonicalItemCode(record.item_code);
    if (!code) missingItemCode++;
    else if (!groupForItemCode(code)) unlisted.set(code, (unlisted.get(code) ?? 0) + 1);
    if (record.is_duplicate) {
      duplicateRecords++;
      const week = bucketStart(record.document_date, "week");
      if (week) duplicates.set(week, (duplicates.get(week) ?? 0) + 1);
    }
  }
  return {
    missingItemCode,
    unlistedItemCodes: [...unlisted].map(([itemCode, count]) => ({ itemCode, records: count })).sort((a, b) => a.itemCode.localeCompare(b.itemCode)),
    duplicateRecords,
    duplicatesByWeek: [...duplicates].map(([week, count]) => ({ week, records: count })).sort((a, b) => a.week.localeCompare(b.week)),
  };
}
