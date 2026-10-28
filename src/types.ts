export type Transfer = {
  id: string;
  transaction_reference: string;
  document_date: string;
  document_time: string | null;
  transferred_from: string;
  transferred_to: string;
  item_code: string;
  description: string;
  product_code: string | null;
  batch_code: string | null;
  quantity: number;
  pallets: string[];
  source_filename: string | null;
  created_at: string;
  /** Set by the records_page database function: another saved record has the same batch, quantity and a shared pallet. */
  is_duplicate?: boolean;
};

export type NewTransfer = Omit<Transfer, "id" | "created_at" | "is_duplicate">;

export type ParsedImport = { rows: import("./constants").ImportRow[]; filenameBatches: number };

export type SortMode = "date-desc" | "date-asc" | "qty-desc" | "qty-asc";

export type RecordFilters = { query: string; dateFrom: string; dateTo: string; batch: string; item: string; sort: SortMode };

/** One page of the Records table. Pages are made of whole transactions (all batches of a transaction stay together). */
export type RecordsPage = { rows: Transfer[]; totalGroups: number; totalRecords: number; totalQuantity: number };

export type ItemStat = { itemCode: string; description: string; records: number; quantity: number; batches: number; pallets: number; destinations: number; latestDate: string };
export type DashboardStats = { records: number; quantity: number; references: number; destinations: number; items: ItemStat[] };

/** What the duplicate check sends to the database for one review row. */
export type DuplicateProbe = { batch: string; item: string; quantity: number | null; pallets: string[] };
