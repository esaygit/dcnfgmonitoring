import { createClient } from "@supabase/supabase-js";
import { itemCodesFor } from "./constants";
import type { DashboardStats, DuplicateProbe, NewTransfer, RecordFilters, RecordsPage, Transfer } from "./types";
import { normalizedDate } from "./utils";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const supabase = url && key ? createClient(url, key) : null;

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

type DashboardStatsResponse = {
  records?: number;
  quantity?: number;
  references?: number;
  destinations?: number;
  items?: {
    item_code: string;
    description?: string | null;
    transactions?: number;
    quantity?: number;
    batches?: number;
    pallets?: number;
    destinations?: number;
    latest_date?: string | null;
  }[];
} | null;

export function mapDashboardStats(stats: DashboardStatsResponse): DashboardStats {
  return {
    records: Number(stats?.records ?? 0),
    quantity: Number(stats?.quantity ?? 0),
    references: Number(stats?.references ?? 0),
    destinations: Number(stats?.destinations ?? 0),
    items: (stats?.items ?? []).map((item) => ({
      itemCode: item.item_code,
      description: item.description ?? "",
      transactions: Number(item.transactions ?? 0),
      quantity: Number(item.quantity ?? 0),
      batches: Number(item.batches ?? 0),
      pallets: Number(item.pallets ?? 0),
      destinations: Number(item.destinations ?? 0),
      latestDate: item.latest_date ?? "",
    })),
  };
}

/** One page of transactions (all batches of each transaction included), filtered and sorted in Postgres. */
export async function fetchRecords(filters: RecordFilters, page: number, pageSize: number): Promise<RecordsPage> {
  const { data, error } = await client().rpc("records_page", {
    p_query: filters.query.trim(),
    p_from: normalizedDate(filters.dateFrom) || null,
    p_to: normalizedDate(filters.dateTo) || null,
    p_batch: filters.batch.trim(),
    p_items: itemCodesFor(filters.item),
    p_sort: filters.sort,
    p_limit: pageSize,
    p_offset: page * pageSize,
    p_from_warehouse: filters.fromWarehouse?.trim() ?? "",
    p_to_warehouse: filters.toWarehouse?.trim() ?? "",
    p_pallet: filters.pallet?.trim() ?? "",
  });
  if (error) throw new Error(error.message);
  const result = data as { rows?: Transfer[]; total_groups?: number; total_records?: number; total_quantity?: number } | null;
  return {
    rows: (result?.rows ?? []).map((row) => ({ ...row, pallets: row.pallets ?? [] })),
    totalGroups: Number(result?.total_groups ?? 0),
    totalRecords: Number(result?.total_records ?? 0),
    totalQuantity: Number(result?.total_quantity ?? 0),
  };
}

/** Every record matching the filters, fetched page by page. Used by the Excel export. */
export async function fetchAllRecords(filters: RecordFilters, onProgress?: (done: number, total: number) => void) {
  const size = 200, all: Transfer[] = [];
  let page = 0, total = Infinity;
  while (page * size < total) {
    const result = await fetchRecords(filters, page, size);
    total = result.totalGroups;
    all.push(...result.rows);
    page++;
    if (!result.rows.length) break;
    onProgress?.(Math.min(page * size, total), total);
  }
  return all;
}

/** Totals and per-item statistics, optionally limited to a document-date range (YYYY-MM-DD). */
export async function fetchStats(from: string | null, to: string | null): Promise<DashboardStats> {
  const { data, error } = await client().rpc("dashboard_stats", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return mapDashboardStats(data as DashboardStatsResponse);
}

/** Asks the database which review rows match an already saved record. Returns row index to transaction reference. */
export async function checkDuplicates(probes: DuplicateProbe[]) {
  const { data, error } = await client().rpc("check_duplicates", { p_rows: probes });
  if (error) throw new Error(error.message);
  const found = new Map<number, string>();
  for (const match of (data ?? []) as { idx: number; reference: string }[]) if (!found.has(match.idx)) found.set(match.idx, match.reference ?? "");
  return found;
}

export async function insertTransfers(data: NewTransfer[]) {
  const { error } = await client().from("transfers").insert(data);
  if (error) throw new Error(error.message);
}
