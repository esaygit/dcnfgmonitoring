import { ITEM_GROUPS, type Header, type ImportRow } from "./constants";
import type { DuplicateProbe } from "./types";
import { normalizedPallets } from "./parse";
import { clean, compare, normalizedDate } from "./utils";

const itemDescriptions = new Map(ITEM_GROUPS.flatMap(({ items }) => items));

export function descriptionForItemCode(code: string) {
  return itemDescriptions.get(clean(code)) ?? "";
}

export function invalidImportFields(row: ImportRow): Partial<Record<Header, string>> {
  const invalid: Partial<Record<Header, string>> = {};
  const required: [Header, string][] = [
    ["Transaction Reference", "Transaction reference is required."],
    ["Transferred From", "Source warehouse is required."],
    ["Transferred To", "Destination warehouse is required."],
    ["Item Code", "Item code is required."],
    ["Description", "Description is required."],
  ];
  required.forEach(([field, reason]) => { if (!clean(row[field])) invalid[field] = reason; });
  if (!normalizedDate(row["Document Date"], false)) invalid["Document Date"] = "Enter a valid date.";
  const quantity = clean(row.Quantity).replace(/,/g, "");
  if (!quantity || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0) invalid.Quantity = "Enter a quantity greater than zero.";
  return invalid;
}

// A possible duplicate has the SAME quantity and at least one SHARED pallet number (same item when both are given).
// Exception: two different lots (batch codes) of the same transaction legitimately share pallets and sometimes
// quantities, so they are never flagged against each other.
type DuplicateKey = { quantity: string | number; pallets: string | string[]; batch: string | null | undefined; item: string | null | undefined; reference?: string | null };

const same = (left: string | null | undefined, right: string | null | undefined) => clean(left ?? "").toLowerCase() === clean(right ?? "").toLowerCase();

export function sameQuantityAndPallet(left: DuplicateKey, right: DuplicateKey) {
  if (clean(left.reference ?? "") && same(left.reference, right.reference) && !same(left.batch, right.batch)) return false;
  if (clean(left.item ?? "") && clean(right.item ?? "") && !same(left.item, right.item)) return false;
  const leftQuantity = String(left.quantity).replace(/,/g, "").trim(), rightQuantity = String(right.quantity).replace(/,/g, "").trim();
  if (!leftQuantity || !rightQuantity || !Number.isFinite(Number(leftQuantity)) || Number(leftQuantity) !== Number(rightQuantity)) return false;
  const rightPallets = new Set(normalizedPallets(right.pallets).map((pallet) => pallet.toLowerCase()));
  return normalizedPallets(left.pallets).some((pallet) => rightPallets.has(pallet.toLowerCase()));
}

export const rowKey = (row: ImportRow): DuplicateKey => ({ quantity: row.Quantity, pallets: row.Pallets, batch: row["Batch Code"], item: row["Item Code"], reference: row["Transaction Reference"] });

/** Index of another review row that looks like a duplicate of rows[index], or -1. */
export function localDuplicateIndex(rows: ImportRow[], index: number) {
  return rows.findIndex((candidate, candidateIndex) => candidateIndex !== index && sameQuantityAndPallet(rowKey(rows[index]), rowKey(candidate)));
}

/** The shape the check_duplicates database function expects for one row. */
export function toProbe(row: ImportRow): DuplicateProbe {
  const quantity = row.Quantity.replace(/,/g, "").trim();
  return {
    batch: clean(row["Batch Code"]),
    item: clean(row["Item Code"]),
    quantity: quantity !== "" && Number.isFinite(Number(quantity)) ? Number(quantity) : null,
    pallets: normalizedPallets(row.Pallets),
    reference: clean(row["Transaction Reference"]),
  };
}

/**
 * Orders review rows oldest to newest by document date plus the time printed in the PDF.
 * Rows without a valid date go last. The sort is stable, so rows from one PDF keep their order.
 */
export function sortReviewRows(rows: ImportRow[], timeOf: (row: ImportRow) => string | undefined) {
  const keyOf = (row: ImportRow) => {
    const date = normalizedDate(row["Document Date"]);
    return date ? `${date}T${timeOf(row) ?? "00:00:00"}` : "\uffff";
  };
  rows.sort((a, b) => compare(keyOf(a), keyOf(b)));
}
