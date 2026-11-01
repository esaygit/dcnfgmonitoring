import type { RecordFilters, SortMode } from "./types";

const SORT_MODES: SortMode[] = ["date-desc", "date-asc", "qty-desc", "qty-asc"];

export function serializeRecordFilters(filters: RecordFilters) {
  const params = new URLSearchParams();
  const values: Record<string, string> = {
    query: filters.query,
    from: filters.dateFrom,
    to: filters.dateTo,
    batch: filters.batch,
    item: filters.item,
    sort: filters.sort,
    fromWarehouse: filters.fromWarehouse ?? "",
    toWarehouse: filters.toWarehouse ?? "",
    pallet: filters.pallet ?? "",
  };
  Object.entries(values).forEach(([key, value]) => { if (value) params.set(key, value); });
  return params.toString();
}

export function parseRecordFilters(search: string): Partial<RecordFilters> {
  const params = new URLSearchParams(search);
  const sort = params.get("sort");
  const sortMode = SORT_MODES.find((mode) => mode === sort) ?? "date-desc";
  return {
    query: params.get("query") ?? "",
    dateFrom: params.get("from") ?? "",
    dateTo: params.get("to") ?? "",
    batch: params.get("batch") ?? "",
    item: params.get("item") ?? "",
    sort: sortMode,
    fromWarehouse: params.get("fromWarehouse") ?? "",
    toWarehouse: params.get("toWarehouse") ?? "",
    pallet: params.get("pallet") ?? "",
  };
}
