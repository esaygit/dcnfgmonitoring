export type RejectionQuantityInput = { quantity: number | string; available: number };

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
