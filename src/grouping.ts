import type { Transfer } from "./types";

/** One transaction can span several batch codes; these fields identify it. */
export const groupKey = (transfer: Transfer) => [transfer.transaction_reference, transfer.document_date, transfer.transferred_from, transfer.transferred_to, transfer.item_code, transfer.description, transfer.product_code ?? ""].join("\u0001");

/** Groups rows that share every identifying value, keeping the incoming order. */
export function groupTransfers(list: Transfer[]) {
  const groups = new Map<string, Transfer[]>();
  for (const transfer of list) {
    const key = groupKey(transfer);
    const group = groups.get(key);
    if (group) group.push(transfer); else groups.set(key, [transfer]);
  }
  return [...groups.values()];
}

/** Pallets are merged across the batches and wrapped to PALLETS_PER_LINE per line (fixed-width column). */
export const PALLETS_PER_LINE = 3;
export function palletLines(pallets: string[]) {
  const lines: string[] = [];
  for (let i = 0; i < pallets.length; i += PALLETS_PER_LINE) lines.push(pallets.slice(i, i + PALLETS_PER_LINE).join(", "));
  return lines.map((line, index) => (index < lines.length - 1 ? `${line},` : line)).join("\n");
}

/** One line per batch, in the same order, so batch code and quantity line up. */
export const stackLines = (members: Transfer[], pick: (transfer: Transfer) => string) => members.map((transfer) => pick(transfer) || (members.length > 1 ? "—" : "")).join("\n");
