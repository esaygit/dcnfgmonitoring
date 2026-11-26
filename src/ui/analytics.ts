import { $, emptyRow } from "../dom";
import { groupForItemCode, ITEM_GROUPS } from "../constants";
import { fetchAllRecords, fetchStats } from "../api";
import type { DashboardStats } from "../types";
import type { RecordFilters } from "../types";
import { comparisonRange } from "../analyticsModel";
import { displayDate, fmt, normalizedDate, pct } from "../utils";
import { countTo, whole } from "./motion";
import { message } from "./toast";
import { initAnalyticsViews, updateAnalyticsViews } from "./analyticsViews";

type AnalyticsChartApi = typeof import("./analyticsCharts");

const analyticsChart = $<HTMLElement>("#analytics-chart"), analyticsBody = $<HTMLTableSectionElement>("#analytics-table tbody");
const fromInput = $<HTMLInputElement>("#analytics-from"), toInput = $<HTMLInputElement>("#analytics-to"), rangeNote = $<HTMLElement>("#analytics-range-note"), totalNote = $<HTMLElement>("#analytics-total-note");
let requestId = 0;

const round2 = (value: number) => Math.round(value * 100) / 100;

function render(stats: DashboardStats, charts: AnalyticsChartApi) {
  const from = normalizedDate(fromInput.value), to = normalizedDate(toInput.value);
  const items = [...stats.items].sort((left, right) => right.quantity - left.quantity || left.itemCode.localeCompare(right.itemCode));
  const itemsQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalQuantity = stats.quantity; // every saved row, so this always matches the Overview total
  const noCodeQuantity = round2(Math.max(0, totalQuantity - itemsQuantity)); // rows saved without an item code
  const largest = items[0];
  countTo($<HTMLElement>("#analytics-item-count"), items.length, whole);
  countTo($<HTMLElement>("#analytics-total-quantity"), totalQuantity);
  $<HTMLElement>("#analytics-largest-item").textContent = largest ? largest.itemCode : "—";
  $<HTMLElement>("#analytics-largest-desc").textContent = largest ? `${largest.description || "No description"} · ${fmt(largest.quantity)}` : "\u00a0";
  const quantities = new Map<string, number>();
  for (const item of items) {
    const code = item.itemCode.trim();
    quantities.set(code, (quantities.get(code) ?? 0) + item.quantity);
  }
  const groupTotal = (group: string) => items.reduce((sum, item) => groupForItemCode(item.itemCode) === group ? sum + item.quantity : sum, 0);
  const ppm10 = groupTotal("10 PPM"), ppm50 = groupTotal("50 PPM");
  countTo($<HTMLElement>("#analytics-ppm10-quantity"), ppm10);
  countTo($<HTMLElement>("#analytics-ppm50-quantity"), ppm50);
  $<HTMLElement>("#analytics-ppm10-share").textContent = `${pct(ppm10, totalQuantity)} of total`;
  $<HTMLElement>("#analytics-ppm50-share").textContent = `${pct(ppm50, totalQuantity)} of total`;

  // Explain any difference between the total and the two PPM groups.
  const other = items.filter((item) => !groupForItemCode(item.itemCode));
  const otherQuantity = round2(other.reduce((sum, item) => sum + item.quantity, 0));
  const reconcile = $<HTMLElement>("#analytics-reconcile");
  const unexplained = otherQuantity > 0 || noCodeQuantity > 0;
  reconcile.classList.toggle("hidden", !unexplained);
  reconcile.textContent = unexplained
    ? `Total ${fmt(totalQuantity)} = 10 PPM ${fmt(ppm10)} + 50 PPM ${fmt(ppm50)}${otherQuantity > 0 ? ` + item codes outside those lists ${fmt(otherQuantity)} (${other.map((item) => `${item.itemCode}: ${fmt(item.quantity)}`).join(", ")})` : ""}${noCodeQuantity > 0 ? ` + records with no item code ${fmt(noCodeQuantity)}` : ""}.`
    : "";
  charts.renderDonut($<HTMLElement>("#analytics-donut-10"), "10 PPM", quantities, from, to);
  charts.renderDonut($<HTMLElement>("#analytics-donut-50"), "50 PPM", quantities, from, to);

  analyticsBody.innerHTML = "";
  charts.renderItemChart(analyticsChart, items, from, to);
  if (!items.length) {
    emptyRow(analyticsBody, 9, "No saved records with an item code in this period.");
    return;
  }
  for (const item of items) {
    const tr = document.createElement("tr");
    [item.itemCode, item.description || "—", String(item.transactions), item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 }), item.transactions ? (item.quantity / item.transactions).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—", String(item.batches), String(item.pallets), String(item.destinations), item.latestDate ? displayDate(item.latestDate) : "—"].forEach((text, index) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (index >= 2 && index <= 7) td.className = "num";
      tr.append(td);
    });
    analyticsBody.append(tr);
  }
}

export async function loadAnalytics() {
  const id = ++requestId, from = normalizedDate(fromInput.value), to = normalizedDate(toInput.value);
  const period = from || to ? `${from ? displayDate(from) : "the first record"} to ${to ? displayDate(to) : "today"}` : "";
  rangeNote.textContent = period ? `Showing production dates ${period}.` : "Showing all saved records.";
  totalNote.textContent = period ? "Selected period" : "All saved records";
  if (from && to && from > to) { rangeNote.textContent = "The start date is after the end date."; return; }
  try {
    const comparison = comparisonRange(from, to);
    const filters = (dateFrom: string, dateTo: string): RecordFilters => ({
      query: "", dateFrom, dateTo, batch: "", pallet: "", item: "", sort: "date-desc",
    });
    const [stats, records, previousStats, previousRecords] = await Promise.all([
      fetchStats(from || null, to || null),
      fetchAllRecords(filters(from, to)),
      comparison ? fetchStats(comparison.from, comparison.to) : Promise.resolve(null),
      comparison ? fetchAllRecords(filters(comparison.from, comparison.to)) : Promise.resolve([]),
    ]);
    if (id !== requestId) return;
    const charts = await import("./analyticsCharts");
    if (id !== requestId) return;
    render(stats, charts);
    updateAnalyticsViews(records, previousRecords, stats, previousStats, from, to, charts);
  } catch (error) {
    if (id === requestId) message(`Could not load analytics: ${error instanceof Error ? error.message : "unexpected error"}`, "error");
  }
}

const isoLocal = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function initAnalytics() {
  initAnalyticsViews();
  fromInput.addEventListener("change", () => void loadAnalytics());
  toInput.addEventListener("change", () => void loadAnalytics());
  document.querySelectorAll<HTMLButtonElement>("[data-range]").forEach((chip) => chip.addEventListener("click", () => {
    const range = chip.dataset.range, today = new Date();
    if (range === "all") { fromInput.value = ""; toInput.value = ""; }
    else if (range === "month") { fromInput.value = isoLocal(new Date(today.getFullYear(), today.getMonth(), 1)); toInput.value = isoLocal(today); }
    else { const start = new Date(today); start.setDate(start.getDate() - (Number(range) - 1)); fromInput.value = isoLocal(start); toInput.value = isoLocal(today); }
    void loadAnalytics();
  }));
}