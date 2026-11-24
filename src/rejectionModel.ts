export type RejectionQuantityInput = { quantity: number | string; available: number };
export type BatchBalanceOption = {
  available_quantity: number;
  item_code: string;
  warehouse_code: string;
};

export type BatchBalanceResolution<T extends BatchBalanceOption> =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "resolved"; option: T };

export function resolveBatchBalance<T extends BatchBalanceOption>(options: T[]): BatchBalanceResolution<T> {
  const positive = options.filter((option) => Number.isFinite(option.available_quantity) && option.available_quantity > 0);
  if (!positive.length) return { kind: "none" };
  if (positive.length > 1) return { kind: "ambiguous" };
  return { kind: "resolved", option: positive[0] };
}

export function remainingRejectedQuantity(quantity: number | string, available: number): number | null {
  const parsed = typeof quantity === "string" ? Number(quantity) : quantity;
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isFinite(available) || available < 0) return null;
  if (parsed > available) return null;
  return available - parsed;
}

export function validateRejectedQuantity(quantity: number | string, available: number): string | null {
  const parsed = typeof quantity === "string" ? (quantity.trim() ? Number(quantity) : NaN) : quantity;
  if (!Number.isFinite(parsed) || parsed <= 0) return "Rejected quantity must be numeric and greater than zero.";
  if (!Number.isFinite(available) || available < 0) return "Available quantity is invalid.";
  if (parsed > available) return `Rejected quantity cannot exceed available quantity (${available}).`;
  return null;
}

export function rejectionLineKey(batchCode: string, itemCode: string, warehouseCode: string) {
  return [batchCode, itemCode, warehouseCode].map((value) => value.trim().toLowerCase()).join("|");
}
