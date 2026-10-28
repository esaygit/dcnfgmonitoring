import { $, emptyRow } from "../dom";
import { GROUP_CLASS, GROUP_OF, ITEM_GROUPS } from "../constants";
import { fetchStats } from "../api";
import type { DashboardStats } from "../types";
import { displayDate, fmt, normalizedDate, pct } from "../utils";
import { message } from "./toast";

const analyticsChart = $<HTMLElement>("#analytics-chart"), analyticsBody = $<HTMLTableSectionElement>("#analytics-table tbody");
const fromInput = $<HTMLInputElement>("#analytics-from"), toInput = $<HTMLInputElement>("#analytics-to"), rangeNote = $<HTMLElement>("#analytics-range-note"), totalNote = $<HTMLElement>("#analytics-total-note");
const DONUT_COLORS = ["#1f6fa5", "#79beee", "#3fb6a8", "#f2b84b"];
let requestId = 0;

function renderDonut(container: HTMLElement, group: string, quantities: Map<string, number>) {
  const entry = ITEM_GROUPS.find((candidate) => candidate.group === group)!;
  const slices = entry.items.map(([code, name], index) => ({ code, name, quantity: quantities.get(code) ?? 0, color: DONUT_COLORS[index % DONUT_COLORS.length] }));
  const total = slices.reduce((sum, slice) => sum + slice.quantity, 0);
  const radius = 72, circumference = 2 * Math.PI * radius, active = slices.filter((slice) => slice.quantity > 0).length, gap = active > 1 ? 3 : 0;
  let offset = 0;
  const arcs = slices.filter((slice) => slice.quantity > 0).map((slice) => {
    const length = slice.quantity / total * circumference, visible = Math.max(length - gap, 0.01);
    const arc = `<circle class="donut-arc" cx="100" cy="100" r="${radius}" fill="none" stroke="${slice.color}" stroke-width="26" stroke-dasharray="${visible} ${circumference - visible}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)"><title>${slice.name}: ${fmt(slice.quantity)} (${pct(slice.quantity, total)})</title></circle>`;
    offset += length;
    return arc;
  }).join("");
  const legend = slices.map((slice) => `<li class="${slice.quantity ? "" : "is-zero"}"><i style="background:${slice.color}"></i><span class="legend-name"><strong>${slice.name}</strong><small>${slice.code}</small></span><span class="legend-value"><strong>${fmt(slice.quantity)}</strong><small>${pct(slice.quantity, total)}</small></span></li>`).join("");
  container.innerHTML = `<div class="donut-figure"><svg viewBox="0 0 200 200" class="donut-svg" role="img" aria-label="${group} quantity by item code, total ${fmt(total)}"><circle cx="100" cy="100" r="${radius}" fill="none" stroke="var(--tint)" stroke-width="26"/>${arcs}</svg><div class="donut-center"><strong>${fmt(total)}</strong><span>${total ? "Total quantity" : "No data yet"}</span></div></div><ul class="donut-legend">${legend}</ul>`;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function render(stats: DashboardStats) {
  const items = [...stats.items].sort((left, right) => right.quantity - left.quantity || left.itemCode.localeCompare(right.itemCode));
  const itemsQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalQuantity = stats.quantity; // every saved row, so this always matches the Overview total
  const noCodeQuantity = round2(Math.max(0, totalQuantity - itemsQuantity)); // rows saved without an item code
  const largest = items[0];
  $<HTMLElement>("#analytics-item-count").textContent = String(items.length);
  $<HTMLElement>("#analytics-total-quantity").textContent = totalQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 });
  $<HTMLElement>("#analytics-largest-item").textContent = largest ? largest.itemCode : "—";
  $<HTMLElement>("#analytics-largest-desc").textContent = largest ? `${largest.description || "No description"} · ${fmt(largest.quantity)}` : "\u00a0";
  const quantities = new Map(items.map((item) => [item.itemCode, item.quantity] as [string, number]));
  const groupTotal = (group: string) => items.reduce((sum, item) => GROUP_OF.get(item.itemCode) === group ? sum + item.quantity : sum, 0);
  const ppm10 = groupTotal("10 PPM"), ppm50 = groupTotal("50 PPM");
  $<HTMLElement>("#analytics-ppm10-quantity").textContent = fmt(ppm10);
  $<HTMLElement>("#analytics-ppm50-quantity").textContent = fmt(ppm50);
  $<HTMLElement>("#analytics-ppm10-share").textContent = `${pct(ppm10, totalQuantity)} of total`;
  $<HTMLElement>("#analytics-ppm50-share").textContent = `${pct(ppm50, totalQuantity)} of total`;

  // Explain any difference between the total and the two PPM groups.
  const other = items.filter((item) => !GROUP_OF.has(item.itemCode));
  const otherQuantity = round2(other.reduce((sum, item) => sum + item.quantity, 0));
  const reconcile = $<HTMLElement>("#analytics-reconcile");
  const unexplained = otherQuantity > 0 || noCodeQuantity > 0;
  reconcile.classList.toggle("hidden", !unexplained);
  reconcile.textContent = unexplained
    ? `Total ${fmt(totalQuantity)} = 10 PPM ${fmt(ppm10)} + 50 PPM ${fmt(ppm50)}${otherQuantity > 0 ? ` + item codes outside those lists ${fmt(otherQuantity)} (${other.map((item) => `${item.itemCode}: ${fmt(item.quantity)}`).join(", ")})` : ""}${noCodeQuantity > 0 ? ` + records with no item code ${fmt(noCodeQuantity)}` : ""}.`
    : "";
  renderDonut($<HTMLElement>("#analytics-donut-10"), "10 PPM", quantities);
  renderDonut($<HTMLElement>("#analytics-donut-50"), "50 PPM", quantities);

  analyticsChart.innerHTML = "";
  analyticsBody.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted analytics-empty";
    empty.textContent = "No item-code analytics for this period. Import records or widen the date range.";
    analyticsChart.append(empty);
    emptyRow(analyticsBody, 9, "No saved records with an item code in this period.");
    return;
  }
  const maximum = Math.max(...items.map((item) => item.quantity));
  for (const item of items) {
    const chartRow = document.createElement("div");
    chartRow.className = "analytics-bar-row";
    const label = document.createElement("div"), name = document.createElement("strong"), description = document.createElement("span");
    label.className = "analytics-bar-label"; name.textContent = item.itemCode; description.textContent = item.description || "No description";
    label.append(name, description);
    const track = document.createElement("div"), bar = document.createElement("span");
    track.className = "analytics-bar-track"; track.setAttribute("role", "img"); track.setAttribute("aria-label", `${item.itemCode}: ${item.quantity.toLocaleString()} total quantity`);
    bar.className = `analytics-bar ${GROUP_CLASS[GROUP_OF.get(item.itemCode) ?? ""] ?? ""}`;
    bar.style.width = `${maximum > 0 ? item.quantity / maximum * 100 : 0}%`;
    track.append(bar);
    const value = document.createElement("strong");
    value.className = "analytics-bar-value"; value.textContent = item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 });
    chartRow.append(label, track, value);
    analyticsChart.append(chartRow);

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
  rangeNote.textContent = period ? `Showing ${period}.` : "Showing all saved records.";
  totalNote.textContent = period ? "Selected period" : "All saved records";
  if (from && to && from > to) { rangeNote.textContent = "The start date is after the end date."; return; }
  try {
    const stats = await fetchStats(from || null, to || null);
    if (id === requestId) render(stats);
  } catch (error) {
    if (id === requestId) message(`Could not load analytics: ${error instanceof Error ? error.message : "unexpected error"}`, "error");
  }
}

const isoLocal = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function initAnalytics() {
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
