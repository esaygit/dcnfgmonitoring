export const HEADERS = ["Transaction Reference", "Document Date", "Transferred From", "Transferred To", "Item Code", "Description", "Product Code", "Batch Code", "Quantity", "Pallets"] as const;
export type Header = (typeof HEADERS)[number];
export type ImportRow = Record<Header, string>;

export const ITEM_GROUPS: { group: string; items: [string, string][] }[] = [
  { group: "50 PPM", items: [["4554770121", "RF MR EXP 50PPM"], ["4554770128", "RF MR DG 50PPM"], ["4554770136", "LF X-FINE EXP 50PPM"], ["4554770130", "RF X-FINE DG 50PPM"]] },
  { group: "10 PPM", items: [["4554770148", "RF MR EXP 10PPM"], ["4554770147", "RF MR DG 10PPM"], ["4554770149", "RF X-XFINE EXP 10PPM"], ["4554770150", "RF X-XFINE DG 10PPM"]] },
];

/** The item filter value is "", an item code, or "group:50 PPM" / "group:10 PPM". */
export const GROUP_PREFIX = "group:";

export const GROUP_OF = new Map<string, string>(ITEM_GROUPS.flatMap(({ group, items }) => items.map(([code]) => [code, group] as [string, string])));
export const GROUP_CLASS: Record<string, string> = { "10 PPM": "ppm-10", "50 PPM": "ppm-50" };

/** Item codes a filter value stands for, or null when no item filter is set. */
export function itemCodesFor(filter: string): string[] | null {
  if (!filter) return null;
  if (filter.startsWith(GROUP_PREFIX)) {
    return ITEM_GROUPS.find((entry) => entry.group === filter.slice(GROUP_PREFIX.length))?.items.map(([code]) => code) ?? [];
  }
  return [filter];
}

/** Human-readable name for an item filter value. */
export function itemFilterName(filter: string): string {
  if (filter.startsWith(GROUP_PREFIX)) return `${filter.slice(GROUP_PREFIX.length)} (all items)`;
  return ITEM_GROUPS.flatMap((entry) => entry.items).find(([code]) => code === filter)?.[1] ?? filter;
}
