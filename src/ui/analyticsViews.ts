import { groupForItemCode } from "../constants";
import { buildBuckets, bucketRange, comparisonRange, percentChange, summarizeQuality, type AnalyticsInterval } from "../analyticsModel";
import type { DashboardStats, Transfer } from "../types";
import { displayDate, fmt } from "../utils";
import { renderMixChart, renderTrendChart, renderVolumeChart } from "./analyticsCharts";

type AnalyticsViewState = {
  records: Transfer[];
  previousRecords: Transfer[];
  from: string;
  to: string;
  comparison: { from: string; to: string } | null;
};

const ppmButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-ppm]")];
const intervalButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-interval]")];
const trendChart = document.querySelector<HTMLElement>("#analytics-trend-chart")!;
const volumeChart = document.querySelector<HTMLElement>("#analytics-volume-chart")!;
const mixChart = document.querySelector<HTMLElement>("#analytics-mix-chart")!;
const qualityMissing = document.querySelector<HTMLElement>("#analytics-missing-count")!;
const qualityMissingLink = document.querySelector<HTMLAnchorElement>("#analytics-missing-link")!;
const qualityUnlisted = document.querySelector<HTMLElement>("#analytics-unlisted-list")!;
const qualityDuplicates = document.querySelector<HTMLTableSectionElement>("#analytics-duplicates-table tbody")!;
const trendNote = document.querySelector<HTMLElement>("#analytics-trend-note")!;
let qualityGroup = "50 PPM";
let interval: AnalyticsInterval = "day";
let state: AnalyticsViewState | null = null;

const groupQuantity = (stats: DashboardStats, group: string) => stats.items.reduce((sum, item) => groupForItemCode(item.itemCode) === group ? sum + item.quantity : sum, 0);

function deltaText(current: number, previous: number | undefined, comparison: AnalyticsViewState["comparison"]) {
  if (!comparison || previous === undefined) return "No previous comparable period";
  const delta = percentChange(current, previous);
  if (delta === null) return "No prior period data to compare";
  const sign = delta > 0 ? "+" : "";
  const days = Math.round((Date.parse(`${comparison.to}T00:00:00Z`) - Date.parse(`${comparison.from}T00:00:00Z`)) / 86400000) + 1;
  return `${sign}${delta}% vs previous ${days} days`;
}

function updateKpis(current: DashboardStats, previous: DashboardStats | null, comparison: AnalyticsViewState["comparison"]) {
  const values = [
    { value: current.quantity, previous: previous?.quantity, valueId: "analytics-trend-total", deltaId: "analytics-trend-total-delta" },
    { value: groupQuantity(current, "10 PPM"), previous: previous ? groupQuantity(previous, "10 PPM") : undefined, valueId: "analytics-trend-ppm10", deltaId: "analytics-trend-ppm10-delta" },
    { value: groupQuantity(current, "50 PPM"), previous: previous ? groupQuantity(previous, "50 PPM") : undefined, valueId: "analytics-trend-ppm50", deltaId: "analytics-trend-ppm50-delta" },
    { value: current.records, previous: previous?.records, valueId: "analytics-trend-records", deltaId: "analytics-trend-records-delta" },
  ];
  for (const item of values) {
    document.getElementById(item.valueId)!.textContent = fmt(item.value);
    document.getElementById(item.deltaId)!.textContent = deltaText(item.value, item.previous, comparison);
  }
}

function renderQuality(records: Transfer[], from: string, to: string) {
  const summary = summarizeQuality(records);
  qualityMissing.textContent = fmt(summary.missingItemCode);
  qualityMissingLink.href = `#/records?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}`;
  qualityUnlisted.replaceChildren();
  if (!summary.unlistedItemCodes.length) {
    qualityUnlisted.textContent = "No unlisted item codes in this range.";
  } else {
    for (const item of summary.unlistedItemCodes) {
      const link = document.createElement("a");
      link.href = `#/records?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), item: item.itemCode }).toString()}`;
      link.className = "quality-list-row";
      const code = document.createElement("strong"), count = document.createElement("span");
      code.textContent = item.itemCode;
      count.textContent = `${fmt(item.records)} ${item.records === 1 ? "record" : "records"}`;
      link.append(code, count);
      qualityUnlisted.append(link);
    }
  }

  qualityDuplicates.replaceChildren();
  for (const item of summary.duplicatesByWeek) {
    const row = document.createElement("tr"), week = document.createElement("td"), count = document.createElement("td");
    const range = bucketRange(item.week, "week", from, to);
    if (range) {
      const link = document.createElement("a");
      link.href = `#/records?${new URLSearchParams({ from: range.from, to: range.to }).toString()}`;
      link.textContent = displayDate(item.week);
      week.append(link);
    } else week.textContent = displayDate(item.week);
    count.textContent = fmt(item.records);
    count.className = "num";
    row.append(week, count);
    qualityDuplicates.append(row);
  }
  if (!summary.duplicatesByWeek.length) {
    const row = document.createElement("tr"), cell = document.createElement("td");
    cell.colSpan = 2;
    cell.textContent = "No flagged possible duplicates in this range.";
    cell.className = "empty";
    row.append(cell);
    qualityDuplicates.append(row);
  }
}

function renderActiveView() {
  if (!state) return;
  const current = buildBuckets(state.records, state.from, state.to, interval);
  const previous = state.comparison
    ? buildBuckets(state.previousRecords, state.comparison.from, state.comparison.to, interval)
    : [];
  renderTrendChart(trendChart, current, previous, qualityGroup, interval, state.from, state.to, state.comparison);
  renderVolumeChart(volumeChart, current, interval, state.from, state.to);
  renderMixChart(mixChart, current, state.from, state.to);
  trendNote.textContent = `Export and downgraded quantities for ${qualityGroup}.`;
}

function selectTab(tab: HTMLButtonElement) {
  const name = tab.dataset.analyticsTab;
  document.querySelectorAll<HTMLButtonElement>("[data-analytics-tab]").forEach((button) => {
    const selected = button === tab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll<HTMLElement>("[data-analytics-panel]").forEach((panel) => {
    const selected = panel.dataset.analyticsPanel === name;
    panel.hidden = !selected;
    panel.classList.toggle("hidden", !selected);
  });
}

export function initAnalyticsViews() {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-analytics-tab]")];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      tabs[next].focus();
      selectTab(tabs[next]);
    });
  });
  ppmButtons.forEach((button) => button.addEventListener("click", () => {
    qualityGroup = button.dataset.ppm ?? "50 PPM";
    ppmButtons.forEach((choice) => choice.setAttribute("aria-pressed", String(choice === button)));
    renderActiveView();
  }));
  intervalButtons.forEach((button) => button.addEventListener("click", () => {
    interval = (button.dataset.interval ?? "day") as AnalyticsInterval;
    intervalButtons.forEach((choice) => choice.setAttribute("aria-pressed", String(choice === button)));
    renderActiveView();
  }));
}

export function updateAnalyticsViews(
  records: Transfer[],
  previousRecords: Transfer[],
  stats: DashboardStats,
  previousStats: DashboardStats | null,
  from: string,
  to: string,
) {
  const comparison = comparisonRange(from, to);
  state = { records, previousRecords, from, to, comparison };
  updateKpis(stats, previousStats, comparison);
  renderQuality(records, from, to);
  renderActiveView();
}
