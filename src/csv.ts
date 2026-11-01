import type { Transfer } from "./types";
import { displayDate, fmt } from "./utils";

const columns = [
  "Transaction Reference", "Document Date", "Document Time", "Transferred From", "Transferred To",
  "Item Code", "Description", "Product Code", "Batch Code", "Quantity", "Pallets", "Source File",
];

const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

export function recordsToCsv(records: Transfer[]) {
  const rows = records.map((record) => [
    record.transaction_reference,
    displayDate(record.document_date),
    record.document_time?.slice(0, 5) ?? "",
    record.transferred_from,
    record.transferred_to,
    record.item_code,
    record.description,
    record.product_code ?? "",
    record.batch_code ?? "",
    fmt(Number(record.quantity)),
    record.pallets.join(", "),
    record.source_filename ?? "",
  ].map(cell).join(","));
  return [columns.map(cell).join(","), ...rows].join("\r\n");
}
