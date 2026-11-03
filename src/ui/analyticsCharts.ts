import { ITEM_GROUPS } from "../constants";
import { analyticsRecordsHref, bucketRange, buildMixSeries, type AnalyticsBucket, type AnalyticsInterval } from "../analyticsModel";
import { fmt } from "../utils";

const NS = "http://www.w3.org/2000/svg";
const WIDTH = 760, HEIGHT = 260, LEFT = 54, RIGHT = 18, TOP = 16, BOTTOM = 42;
const ITEM_COLORS = ["#155b94", "#438fc1", "#79beee", "#abd8f3", "#087f8c", "#32a6a6", "#70c2b5", "#a9d9c9"];

function svgNode<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}, text?: string) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function chartSvg(label: string) {
  const svg = svgNode("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: "group", "aria-label": label });
  svg.classList.add("analytics-svg");
  return svg;
}

function addAxis(svg: SVGSVGElement, max: number) {
  const chartHeight = HEIGHT - TOP - BOTTOM, chartWidth = WIDTH - LEFT - RIGHT;
  const upper = Math.max(1, Math.ceil(max / 3) * 3);
  for (let tick = 0; tick <= 3; tick++) {
    const value = upper * tick / 3, y = TOP + chartHeight - (value / upper) * chartHeight;
    svg.append(
      svgNode("line", { x1: LEFT, x2: WIDTH - RIGHT, y1: y, y2: y, class: "analytics-gridline" }),
      svgNode("text", { x: LEFT - 10, y: y + 4, "text-anchor": "end", class: "analytics-axis-label" }, fmt(value)),
    );
  }
  return {
    upper,
    x: (index: number, count: number) => LEFT + (count < 2 ? chartWidth / 2 : index / (count - 1) * chartWidth),
    y: (value: number) => TOP + chartHeight - value / upper * chartHeight,
    chartHeight,
  };
}

function addXLabels(svg: SVGSVGElement, buckets: AnalyticsBucket[], x: (index: number, count: number) => number) {
  if (!buckets.length) return;
  const count = buckets.length, stride = Math.max(1, Math.ceil(count / 6));
  for (let index = 0; index < count; index += stride) {
    svg.append(svgNode("text", { x: x(index, count), y: HEIGHT - 12, "text-anchor": index === 0 ? "start" : "middle", class: "analytics-axis-label" }, buckets[index].label));
  }
  if ((count - 1) % stride !== 0 && count > 1) {
    svg.append(svgNode("text", { x: x(count - 1, count), y: HEIGHT - 12, "text-anchor": "end", class: "analytics-axis-label" }, buckets[count - 1].label));
  }
}

function linePath(values: number[], x: (index: number, count: number) => number, y: (value: number) => number) {
  return values.map((value, index) => `${index ? "L" : "M"}${x(index, values.length)},${y(value)}`).join(" ");
}

function areaPath(values: number[], x: (index: number, count: number) => number, y: (value: number) => number, baseline: number) {
  if (!values.length) return "";
  return `${linePath(values, x, y)} L${x(values.length - 1, values.length)},${baseline} L${x(0, values.length)},${baseline} Z`;
}

function addLegend(container: HTMLElement, entries: { label: string; color: string; dashed?: boolean; area?: boolean }[]) {
  const legend = document.createElement("div");
  legend.className = "analytics-legend";
  for (const entry of entries) {
    const item = document.createElement("span"), mark = document.createElement("i");
    mark.style.setProperty("--legend-color", entry.color);
    if (entry.dashed) mark.classList.add("is-dashed");
    if (entry.area) mark.classList.add("is-area");
    item.append(mark, document.createTextNode(entry.label));
    legend.append(item);
  }
  container.append(legend);
}

export function renderTrendChart(
  container: HTMLElement,
  current: AnalyticsBucket[],
  previous: AnalyticsBucket[],
  group: string,
  interval: AnalyticsInterval,
  from: string,
  to: string,
  comparison: { from: string; to: string } | null,
) {
  container.replaceChildren();
  if (!current.length) {
    container.textContent = "No dated transfers are available for this range.";
    return;
  }
  const series = group === "50 PPM"
    ? [
      { key: "exports50" as const, label: "Exports", filter: `group:${group}:exports`, color: "#1f6fa5" },
      { key: "downgraded50" as const, label: "Downgraded", filter: `group:${group}:downgraded`, color: "#3fb6a8" },
    ]
    : [
      { key: "exports10" as const, label: "Exports", filter: `group:${group}:exports`, color: "#1f6fa5" },
      { key: "downgraded10" as const, label: "Downgraded", filter: `group:${group}:downgraded`, color: "#3fb6a8" },
    ];
  const previousValues = series.map(({ key }) => current.map((_, index) => {
    if (!previous.length) return 0;
    const previousIndex = current.length < 2 || previous.length < 2 ? 0 : Math.round(index / (current.length - 1) * (previous.length - 1));
    return previous[previousIndex][key];
  }));
  const max = Math.max(0, ...current.flatMap((bucket) => series.map(({ key }) => bucket[key])), ...previousValues.flat());
  const svg = chartSvg(`${group} export and downgraded quantities over time`);
  const axis = addAxis(svg, max);
  const baseline = HEIGHT - BOTTOM;
  for (const entry of series) {
    const values = current.map((bucket) => bucket[entry.key]);
    svg.append(svgNode("path", { d: areaPath(values, axis.x, axis.y, baseline), fill: entry.color, "fill-opacity": 0.1, class: "analytics-area" }));
  }
  if (comparison && previous.length) {
    series.forEach((entry, seriesIndex) => {
      svg.append(svgNode("path", {
        d: linePath(previousValues[seriesIndex], axis.x, axis.y),
        fill: "none", stroke: entry.color, "stroke-width": 2, "stroke-dasharray": "6 6", opacity: 0.48,
        class: "analytics-comparison-line",
      }));
    });
  }
  series.forEach((entry) => {
    const values = current.map((bucket) => bucket[entry.key]);
    svg.append(svgNode("path", { d: linePath(values, axis.x, axis.y), fill: "none", stroke: entry.color, "stroke-width": 3.5, "stroke-linejoin": "round", "stroke-linecap": "round", class: "analytics-line" }));
    values.forEach((value, index) => {
      const range = bucketRange(current[index].key, interval, from, to);
      if (!range) return;
      const link = svgNode("a", { href: analyticsRecordsHref(range.from, range.to, entry.filter), "aria-label": `${current[index].label}, ${entry.label}, ${fmt(value)} quantity` });
      link.append(
        svgNode("circle", { cx: axis.x(index, values.length), cy: axis.y(value), r: 12, class: "analytics-point-hit" }),
        svgNode("circle", { cx: axis.x(index, values.length), cy: axis.y(value), r: 5, fill: entry.color, class: "analytics-point" }),
        svgNode("title", {}, `${current[index].label} · ${entry.label}: ${fmt(value)}`),
      );
      svg.append(link);
    });
  });
  addXLabels(svg, current, axis.x);
  container.append(svg);
  const entries = series.map(({ label, color }) => ({ label, color }));
  if (comparison && previous.length) entries.push({ label: "Previous period", color: "var(--ink-2)", dashed: true } as typeof entries[number]);
  addLegend(container, entries);
}

export function renderVolumeChart(container: HTMLElement, buckets: AnalyticsBucket[], interval: AnalyticsInterval, from: string, to: string) {
  container.replaceChildren();
  if (!buckets.length) {
    container.textContent = "No dated transfers are available for this range.";
    return;
  }
  const max = Math.max(0, ...buckets.map((bucket) => bucket.ppm10 + bucket.ppm50));
  const svg = chartSvg("Transfer quantity by time period, stacked by PPM group");
  const axis = addAxis(svg, max), plotWidth = WIDTH - LEFT - RIGHT;
  const slot = plotWidth / buckets.length, barWidth = Math.max(2, Math.min(20, slot * 0.68));
  buckets.forEach((bucket, index) => {
    const x = axis.x(index, buckets.length) - barWidth / 2;
    const range = bucketRange(bucket.key, interval, from, to);
    if (!range) return;
    let bottom = HEIGHT - BOTTOM;
    for (const group of [
      { name: "10 PPM", value: bucket.ppm10, color: "#1f6fa5" },
      { name: "50 PPM", value: bucket.ppm50, color: "#79beee" },
    ]) {
      if (!group.value) continue;
      const height = group.value / axis.upper * axis.chartHeight, y = bottom - height;
      const link = svgNode("a", { href: analyticsRecordsHref(range.from, range.to, `group:${group.name}`), "aria-label": `${bucket.label}, ${group.name}, ${fmt(group.value)} quantity` });
      link.append(
        svgNode("rect", { x, y, width: barWidth, height: Math.max(1, height), rx: Math.min(4, barWidth / 3), fill: group.color, class: "analytics-bar-segment" }),
        svgNode("title", {}, `${bucket.label} · ${group.name}: ${fmt(group.value)}`),
      );
      svg.append(link);
      bottom = y;
    }
  });
  addXLabels(svg, buckets, axis.x);
  container.append(svg);
  addLegend(container, [{ label: "10 PPM", color: "#1f6fa5", area: true }, { label: "50 PPM", color: "#79beee", area: true }]);
}

export function renderMixChart(container: HTMLElement, buckets: AnalyticsBucket[], group: string, from: string, to: string) {
  container.replaceChildren();
  const series = buildMixSeries(buckets, group);
  if (!buckets.length || !series.length) {
    container.textContent = `No ${group} item-code quantities are available for this range.`;
    return;
  }
  const codes = series.map(({ itemCode }) => itemCode);
  const svg = chartSvg(`100 percent stacked area showing the ${group} item-code mix over time`);
  const axis = addAxis(svg, 100);
  if (buckets.length === 1) {
    let bottom = HEIGHT - BOTTOM;
    for (const item of series) {
      const share = item.values[0];
      if (!share) continue;
      const colorIndex = ITEM_GROUPS.flatMap(({ items }) => items.map(([itemCode]) => itemCode)).indexOf(item.itemCode) % ITEM_COLORS.length;
      const height = share / axis.upper * axis.chartHeight, y = bottom - height;
      const link = svgNode("a", { href: analyticsRecordsHref(from, to, item.itemCode), "aria-label": `${item.itemCode}, ${fmt(share)} percent of ${group} item mix, view records` });
      link.append(svgNode("rect", { x: axis.x(0, 1) - 12, y, width: 24, height, fill: ITEM_COLORS[colorIndex], "fill-opacity": 0.76, class: "analytics-bar-segment" }));
      svg.append(link);
      bottom = y;
    }
    addXLabels(svg, buckets, axis.x);
    container.append(svg);
    addLegend(container, series.map(({ itemCode }) => ({
      label: `${itemCode} · ${ITEM_GROUPS.flatMap(({ items }) => items).find(([code]) => code === itemCode)?.[1] ?? itemCode}`,
      color: ITEM_COLORS[ITEM_GROUPS.flatMap(({ items }) => items.map(([code]) => code)).indexOf(itemCode) % ITEM_COLORS.length],
      area: true,
    })));
    return;
  }
  for (const [seriesIndex, item] of series.entries()) {
    const values = item.values;
    const bottoms = buckets.map((_, index) => series.slice(0, seriesIndex).reduce((sum, prior) => sum + prior.values[index], 0));
    const tops = values.map((value, index) => value + bottoms[index]);
    const upperPath = tops.map((value, index) => `${index ? "L" : "M"}${axis.x(index, tops.length)},${axis.y(value)}`).join(" ");
    const lowerPath = bottoms.map((_, index) => index).reverse().map((index) => `L${axis.x(index, bottoms.length)},${axis.y(bottoms[index])}`).join(" ");
    const colorIndex = ITEM_GROUPS.flatMap(({ items }) => items.map(([code]) => code)).indexOf(item.itemCode) % ITEM_COLORS.length;
    const path = svgNode("path", { d: `${upperPath} ${lowerPath} Z`, fill: ITEM_COLORS[colorIndex], "fill-opacity": 0.88, stroke: "var(--surface)", "stroke-width": 2, class: "analytics-mix-area" });
    const link = svgNode("a", { href: analyticsRecordsHref(from, to, item.itemCode), "aria-label": `${item.itemCode}, ${ITEM_GROUPS.flatMap(({ items }) => items).find(([code]) => code === item.itemCode)?.[1] ?? item.itemCode}, view ${group} records` });
    link.append(path, svgNode("title", {}, `${item.itemCode} · ${values.map((value, index) => `${buckets[index].label}: ${fmt(value)}%`).join(" · ")}`));
    svg.append(link);
  }
  addXLabels(svg, buckets, axis.x);
  container.append(svg);
  addLegend(container, series.map(({ itemCode }) => ({
    label: `${itemCode} · ${ITEM_GROUPS.flatMap(({ items }) => items).find(([code]) => code === itemCode)?.[1] ?? itemCode}`,
    color: ITEM_COLORS[ITEM_GROUPS.flatMap(({ items }) => items.map(([code]) => code)).indexOf(itemCode) % ITEM_COLORS.length],
    area: true,
  })));
}
