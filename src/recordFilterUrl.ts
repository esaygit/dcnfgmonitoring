import type { RecordFilters, SortMode } from "./types";

const SORT_MODES: SortMode[] = ["date-desc", "date-asc", "qty-desc", "qty-asc"];

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
  };
}
