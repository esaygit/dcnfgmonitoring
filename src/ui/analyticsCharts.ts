import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GraphicComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import type { ECharts, EChartsCoreOption } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { ITEM_GROUPS, groupForItemCode } from "../constants";
import { analyticsRecordsHref, bucketRange, buildMixSeries, type AnalyticsBucket, type AnalyticsInterval } from "../analyticsModel";
import { fmt, pct } from "../utils";

echarts.use([GraphicComponent, GridComponent, LegendComponent, TooltipComponent, BarChart, LineChart, PieChart, CanvasRenderer]);

type ChartColors = {
  accent: string;
  sky: string;
  ink: string;
  muted: string;
  line: string;
  surface: string;
  raised: string;
  teal: string;
  fontFamily: string;
  palette: string[];
};

type ChartInstance = {
  chart: ECharts;
  observer: ResizeObserver;
  option: () => EChartsCoreOption;
};

type ChartLink = { href: string; label: string };

const ITEM_COLORS = ["#155b94", "#438fc1", "#79beee", "#abd8f3", "#087f8c", "#32a6a6", "#70c2b5", "#a9d9c9"];
const instances = new Map<HTMLElement, ChartInstance>();

function colors(): ChartColors {
  const styles = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    accent: get("--accent", "#1a6db0"),
    sky: get("--sky", "#79beee"),
    ink: get("--ink", "#0e2234"),
    muted: get("--ink-2", "#587085"),
    line: get("--line", "#e2e9f0"),
    surface: get("--surface", "#ffffff"),
    raised: get("--raised", "#f7f9fc"),
    teal: get("--ok", "#168779"),
    fontFamily: styles.fontFamily,
    palette: ITEM_COLORS,
  };
}

function disposeChart(container: HTMLElement) {
  const instance = instances.get(container);
  if (!instance) return;
  instance.observer.disconnect();
  instance.chart.dispose();
  instances.delete(container);
}

function showEmpty(container: HTMLElement, message: string) {
  disposeChart(container);
  container.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "analytics-chart-empty";
  empty.textContent = message;
  container.append(empty);
}

function createChart(container: HTMLElement, label: string, height: number, buildOption: () => EChartsCoreOption, links: ChartLink[] = []) {
  disposeChart(container);
  const host = document.createElement("div");
  host.className = "analytics-echart";
  host.style.height = `${height}px`;
  host.setAttribute("role", "img");
  host.setAttribute("aria-label", label);
  const linkList = document.createElement("div");
  linkList.className = "analytics-chart-a11y";
  linkList.setAttribute("role", "group");
  linkList.setAttribute("aria-label", `${label} record links`);
  for (const { href, label: linkLabel } of links) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = linkLabel;
    linkList.append(link);
  }
  container.replaceChildren(host, ...(links.length ? [linkList] : []));

  const chart = echarts.init(host, null, { renderer: "canvas", useCoarsePointer: true });
  const observer = new ResizeObserver(() => chart.resize());
  observer.observe(host);
  const instance = { chart, observer, option: buildOption };
  instances.set(container, instance);
  chart.setOption(buildOption());
  chart.on("click", ({ data }) => {
    const href = typeof data === "object" && data !== null && "href" in data && typeof data.href === "string"
      ? data.href
      : "";
    if (href.startsWith("#/records?")) window.location.hash = href;
  });
  return chart;
}

function baseOption(palette: ChartColors): Pick<EChartsCoreOption, "animation" | "animationDuration" | "animationEasing"> {
  return {
    animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    animationDuration: 650,
    animationEasing: "cubicOut",
  };
}

function axisLabelColors(palette: ChartColors) {
  return {
    color: palette.muted,
    fontSize: 11,
    fontFamily: palette.fontFamily,
    hideOverlap: true,
  };
}

function commonXAxis(palette: ChartColors, labels: string[]) {
  return {
    type: "category" as const,
    boundaryGap: false,
    data: labels,
    axisLine: { lineStyle: { color: palette.line } },
    axisTick: { show: false },
    axisLabel: { ...axisLabelColors(palette), margin: 14 },
    splitLine: { show: false },
  };
}

function commonYAxis(palette: ChartColors, max?: number) {
  return {
    type: "value" as const,
    ...(max === undefined ? {} : { max }),
    min: 0,
    minInterval: 1,
    axisLabel: { ...axisLabelColors(palette), margin: 12, formatter: (value: number) => fmt(value) },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: palette.line, type: "dashed" as const } },
  };
}

function commonLegend(palette: ChartColors) {
  return {
    top: 0,
    left: 10,
    itemWidth: 16,
    itemHeight: 8,
    itemGap: 22,
    icon: "roundRect" as const,
    textStyle: { color: palette.muted, fontFamily: palette.fontFamily, fontSize: 12 },
    selectedMode: false as const,
  };
}

function tooltipValue(palette: ChartColors) {
  return {
    trigger: "axis" as const,
    confine: true,
    backgroundColor: palette.surface,
    borderColor: palette.line,
    borderWidth: 1,
    padding: [10, 14],
    textStyle: { color: palette.ink, fontFamily: palette.fontFamily, fontSize: 12 },
    axisPointer: { type: "line" as const, lineStyle: { color: palette.accent, type: "dashed" as const, opacity: 0.55 } },
    valueFormatter: (value: number | string) => fmt(Number(value)),
  };
}

export function resizeAnalyticsCharts() {
  for (const { chart } of instances.values()) chart.resize();
}

window.addEventListener("dcn:themechange", () => {
  for (const { chart, option } of instances.values()) {
    chart.setOption(option(), true);
    chart.resize();
  }
});

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
  if (!current.length) {
    showEmpty(container, "No dated transfers are available for this range.");
    return;
  }
  const series = group === "50 PPM"
    ? [
      { key: "exports50" as const, label: "Exports", filter: `group:${group}:exports` },
      { key: "downgraded50" as const, label: "Downgraded", filter: `group:${group}:downgraded` },
    ]
    : [
      { key: "exports10" as const, label: "Exports", filter: `group:${group}:exports` },
      { key: "downgraded10" as const, label: "Downgraded", filter: `group:${group}:downgraded` },
    ];
  const previousValues = series.map(({ key }) => current.map((_, index) => {
    if (!previous.length) return 0;
    const previousIndex = current.length < 2 || previous.length < 2 ? 0 : Math.round(index / (current.length - 1) * (previous.length - 1));
    return previous[previousIndex][key];
  }));
  const labels = current.map(({ label }) => label);
  const links = current.flatMap((bucket) => {
    const range = bucketRange(bucket.key, interval, from, to);
    return range ? series.map((entry) => ({
      href: analyticsRecordsHref(range.from, range.to, entry.filter),
      label: `${bucket.label}, ${entry.label}: view records`,
    })) : [];
  });
  createChart(container, `${group} export and downgraded quantities over time`, 340, () => {
    const palette = colors();
    return {
      ...baseOption(palette),
      tooltip: tooltipValue(palette),
      legend: commonLegend(palette),
      grid: { top: 48, right: 24, bottom: 42, left: 78, containLabel: false },
      xAxis: commonXAxis(palette, labels),
      yAxis: commonYAxis(palette),
      series: [
        ...series.map((entry) => ({
          name: entry.label,
          type: "line" as const,
          smooth: 0.28,
          showSymbol: current.length <= 60,
          symbol: "circle",
          symbolSize: 8,
          lineStyle: { width: 3, cap: "round" as const, color: entry.label === "Exports" ? palette.accent : palette.teal },
          itemStyle: { color: entry.label === "Exports" ? palette.accent : palette.teal, borderColor: palette.surface, borderWidth: 2 },
          emphasis: { focus: "series" as const, scale: 1.35 },
          data: current.map((bucket) => {
            const range = bucketRange(bucket.key, interval, from, to);
            return {
              value: bucket[entry.key],
              ...(range ? { href: analyticsRecordsHref(range.from, range.to, entry.filter) } : {}),
            };
          }),
        })),
        ...(comparison && previous.length ? series.map((entry, seriesIndex) => ({
          name: `${entry.label} · previous`,
          type: "line" as const,
          smooth: 0.28,
          showSymbol: false,
          silent: true,
          lineStyle: { width: 2, type: "dashed" as const, opacity: 0.48, color: entry.label === "Exports" ? palette.accent : palette.teal },
          itemStyle: { color: entry.label === "Exports" ? palette.accent : palette.teal },
          data: previousValues[seriesIndex],
        })) : []),
      ],
    };
  }, links);
}

export function renderVolumeChart(container: HTMLElement, buckets: AnalyticsBucket[], interval: AnalyticsInterval, from: string, to: string) {
  if (!buckets.length) {
    showEmpty(container, "No dated transfers are available for this range.");
    return;
  }
  const labels = buckets.map(({ label }) => label);
  const groups = [
    { name: "10 PPM", key: "ppm10" as const },
    { name: "50 PPM", key: "ppm50" as const },
  ];
  const links = buckets.flatMap((bucket) => {
    const range = bucketRange(bucket.key, interval, from, to);
    return range ? groups.map((group) => ({
      href: analyticsRecordsHref(range.from, range.to, `group:${group.name}`),
      label: `${bucket.label}, ${group.name}: view records`,
    })) : [];
  });
  createChart(container, "Transfer quantity by time period, stacked by PPM group", 320, () => {
    const palette = colors();
    return {
      ...baseOption(palette),
      tooltip: tooltipValue(palette),
      legend: commonLegend(palette),
      grid: { top: 48, right: 24, bottom: 42, left: 78 },
      xAxis: { ...commonXAxis(palette, labels), boundaryGap: true, axisLabel: { ...axisLabelColors(palette), margin: 14, interval: "auto" } },
      yAxis: commonYAxis(palette),
      series: groups.map((group) => ({
        name: group.name,
        type: "bar" as const,
        stack: "quantity",
        barMaxWidth: 24,
        itemStyle: {
          color: group.key === "ppm10" ? palette.accent : palette.sky,
          borderRadius: group.key === "ppm50" ? [5, 5, 0, 0] : [0, 0, 0, 0],
        },
        emphasis: { focus: "series" as const },
        data: buckets.map((bucket) => {
          const range = bucketRange(bucket.key, interval, from, to);
          return {
            value: bucket[group.key],
            ...(range ? { href: analyticsRecordsHref(range.from, range.to, `group:${group.name}`) } : {}),
          };
        }),
      })),
    };
  }, links);
}

export function renderMixChart(container: HTMLElement, buckets: AnalyticsBucket[], group: string, from: string, to: string) {
  const mix = buildMixSeries(buckets, group);
  if (!buckets.length || !mix.length) {
    showEmpty(container, `No ${group} item-code quantities are available for this range.`);
    return;
  }
  const labels = buckets.map(({ label }) => label);
  const links = mix.map((item) => ({
    href: analyticsRecordsHref(from, to, item.itemCode),
    label: `${item.itemCode}: view ${group} records`,
  }));
  createChart(container, `100 percent stacked area showing the ${group} item-code mix over time`, 340, () => {
    const palette = colors();
    return {
      ...baseOption(palette),
      tooltip: tooltipValue(palette),
      legend: {
        ...commonLegend(palette),
        type: "scroll",
        left: 0,
        right: 0,
        itemGap: 16,
        formatter: (name: string) => `${name} · ${ITEM_GROUPS.flatMap(({ items }) => items).find(([code]) => code === name)?.[1] ?? name}`,
      },
      grid: { top: 54, right: 24, bottom: 42, left: 62 },
      xAxis: commonXAxis(palette, labels),
      yAxis: {
        ...commonYAxis(palette, 100),
        axisLabel: { ...axisLabelColors(palette), margin: 12, formatter: (value: number) => `${value}%` },
      },
      series: mix.map((item, index) => ({
        name: item.itemCode,
        type: "line" as const,
        stack: "share",
        smooth: 0.25,
        showSymbol: false,
        lineStyle: { width: 1.5, color: palette.surface },
        areaStyle: { opacity: 0.86 },
        emphasis: { focus: "series" as const, lineStyle: { width: 2.5 } },
        itemStyle: { color: palette.palette[index % palette.palette.length] },
        data: item.values.map((value, bucketIndex) => ({
          value,
          href: analyticsRecordsHref(from, to, item.itemCode),
          bucketLabel: labels[bucketIndex],
        })),
      })),
    };
  }, links);
}

export type AnalyticsItem = { itemCode: string; description: string; quantity: number };

export function renderItemChart(container: HTMLElement, items: AnalyticsItem[], from: string, to: string) {
  if (!items.length) {
    showEmpty(container, "No item-code analytics for this period. Import records or widen the date range.");
    return;
  }
  const height = Math.max(300, Math.min(780, items.length * 38 + 76));
  const links = items.map((item) => ({
    href: analyticsRecordsHref(from, to, item.itemCode),
    label: `${item.itemCode}, ${fmt(item.quantity)}: view records`,
  }));
  createChart(container, "Total quantity by item code, highest volume first", height, () => {
    const palette = colors();
    return {
      ...baseOption(palette),
      tooltip: tooltipValue(palette),
      grid: { top: 14, right: 62, bottom: 30, left: 92 },
      xAxis: {
        ...commonYAxis(palette),
        axisLabel: { ...axisLabelColors(palette), formatter: (value: number) => fmt(value) },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: items.map(({ itemCode }) => itemCode),
        axisLabel: { ...axisLabelColors(palette), fontSize: 12, width: 72, overflow: "truncate" as const },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [{
        type: "bar",
        barMaxWidth: 18,
        showBackground: true,
        backgroundStyle: { color: palette.raised, borderRadius: 9 },
        itemStyle: { borderRadius: [0, 8, 8, 0] },
        label: {
          show: true,
          position: "right",
          color: palette.muted,
          fontSize: 11,
          fontFamily: palette.fontFamily,
          formatter: ({ value }: { value: number }) => fmt(value),
        },
        data: items.map((item) => ({
          value: item.quantity,
          itemStyle: { color: groupForItemCode(item.itemCode) === "50 PPM" ? palette.sky : palette.accent },
          itemCode: item.itemCode,
          description: item.description,
          href: analyticsRecordsHref(from, to, item.itemCode),
        })),
      }],
    };
  }, links);
}

export function renderDonut(container: HTMLElement, group: string, quantities: Map<string, number>, from: string, to: string) {
  const entry = ITEM_GROUPS.find((candidate) => candidate.group === group);
  if (!entry) {
    showEmpty(container, `No ${group} item-code quantities are available.`);
    return;
  }
  const slices = entry.items.map(([code, name], index) => ({
    code,
    name,
    quantity: quantities.get(code) ?? 0,
    color: ITEM_COLORS[index % ITEM_COLORS.length],
  }));
  const total = slices.reduce((sum, slice) => sum + slice.quantity, 0);
  const labelByName = new Map(slices.map((slice) => [`${slice.code} · ${slice.name}`, slice]));
  const links = slices.filter((slice) => slice.quantity > 0).map((slice) => ({
    href: analyticsRecordsHref(from, to, slice.code),
    label: `${slice.name}, ${fmt(slice.quantity)}: view records`,
  }));
  createChart(container, `${group} quantity by item code, total ${fmt(total)}`, 270, () => {
    const palette = colors();
    return {
      ...baseOption(palette),
      tooltip: {
        ...tooltipValue(palette),
        trigger: "item",
        formatter: (item: { name: string; value: number }) => {
          const slice = labelByName.get(item.name);
          return `${slice?.name ?? item.name}<br/>${fmt(item.value)} · ${pct(item.value, total)}`;
        },
      },
      legend: {
        type: "scroll",
        orient: "vertical",
        left: "53%",
        right: 8,
        top: "middle",
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 14,
        textStyle: { color: palette.muted, fontFamily: palette.fontFamily, fontSize: 11, width: 150, overflow: "truncate" },
        formatter: (name: string) => name,
      },
      graphic: [
        {
          type: "text",
          left: "26%",
          top: "44%",
          style: { text: fmt(total), fill: palette.ink, fontSize: 20, fontWeight: 700, textAlign: "center" },
        },
        {
          type: "text",
          left: "26%",
          top: "54%",
          style: { text: total ? "Total quantity" : "No data yet", fill: palette.muted, fontSize: 10, textAlign: "center" },
        },
      ],
      series: [{
        name: `${group} quantity`,
        type: "pie",
        center: ["26%", "50%"],
        radius: ["53%", "76%"],
        avoidLabelOverlap: true,
        padAngle: 2,
        itemStyle: { borderColor: palette.surface, borderWidth: 2, borderRadius: 3 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 5, itemStyle: { shadowBlur: 14, shadowColor: "#0e223422" } },
        data: slices.map((slice) => ({
          name: `${slice.code} · ${slice.name}`,
          value: slice.quantity,
          itemStyle: { color: slice.color },
          href: analyticsRecordsHref(from, to, slice.code),
        })),
      }],
    };
  }, links);
}
