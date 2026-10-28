import type { ParsedImport } from "./types";
import { clean, matched, normalizedDate, normalizedTime } from "./utils";

const TIME = String.raw`(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)`;

/**
 * Time printed inside the PDF, as HH:MM:SS, or "".
 * Tries "DOCUMENT TIME: 14:32", a time right after the document date, then any "TIME: 14:32".
 * If your IWTS PDFs label the time differently, add the label here.
 */
export function pdfTime(text: string) {
  return normalizedTime(
    matched(text, new RegExp(String.raw`DOCUMENT\s+TIME\s*:\s*${TIME}`, "i")) ||
    matched(text, new RegExp(String.raw`DOCUMENT\s+DATE\s*:\s*\S+\s+${TIME}`, "i")) ||
    matched(text, new RegExp(String.raw`\bTIME\s*:\s*${TIME}`, "i"))
  );
}

/** Pallet numbers written in the file name after the word PALLET(S), e.g. "PALLETS 1001 1002 20261027.pdf". */
export function palletsFromFilename(filename: string) {
  const part = filename.replace(/\.pdf$/i, "").match(/\bPALLETS?\s+(.+?)(?=\s+\d{8}\b|$)/i)?.[1] ?? "";
  return (part.match(/\b\d{3,6}\b/g) ?? []).join(", ");
}

/** "B240101 700 BAGS B240102 500 BAGS" in the file name becomes one entry per batch. */
export function batchesFromFilename(filename: string) {
  const name = filename.replace(/\.pdf$/i, "");
  return [...name.matchAll(/\b([A-Z0-9]{5,}(?:-[A-Z0-9]+)*)\s+(\d+(?:\.\d+)?)\s*BAGS?\b/gi)].map((match) => ({ batch: match[1], quantity: match[2] }));
}

export function normalizedPallets(value: string | string[]) {
  return (Array.isArray(value) ? value : value.split(",")).map((pallet) => pallet.trim()).filter(Boolean);
}

export function parse(text: string, filename: string): ParsedImport {
  const documentDate = matched(text, /DOCUMENT\s+DATE\s*:\s*((?:\d{4}[-/]\d{1,2}[-/]\d{1,2})|(?:\d{1,2}[-/]\d{1,2}[-/]\d{2,4}))/i);
  const base = {
    "Transaction Reference": matched(text, /\b(GAA\s*\d{4,})\b/i).replace(/\s+/g, ""),
    "Document Date": normalizedDate(documentDate),
    "Transferred From": matched(text, /SHIP\s+FROM\s*:\s*(W\d+)/i),
    "Transferred To": matched(text, /SHIP\s+TO\s*:\s*(W\d+)/i),
    "Pallets": palletsFromFilename(filename),
  };
  const items = [...text.matchAll(/(?:^|\s)(\d{8,})\s*(.*?)\s+([A-Z0-9-]+)LOC\s+([A-Z0-9-]+)\s+([\d,]+(?:\.\d+)?)(?=\s+)/gi)];
  const filenameBatches = batchesFromFilename(filename);
  const itemRows = items.map((item) => ({ ...base, "Item Code": clean(item[1]), "Description": clean(item[2]), "Product Code": clean(item[3]), "Batch Code": clean(item[4]), "Quantity": clean(item[5]) }));
  if (filenameBatches.length > 1 && itemRows.length <= 1) {
    const template = itemRows[0] ?? { ...base, "Item Code": "", "Description": "", "Product Code": "", "Batch Code": "", "Quantity": "" };
    return { rows: filenameBatches.map(({ batch, quantity }) => ({ ...template, "Batch Code": batch, Quantity: quantity })), filenameBatches: filenameBatches.length };
  }
  if (!itemRows.length) return { rows: [{ ...base, "Item Code": "", "Description": "", "Product Code": "", "Batch Code": "", "Quantity": "" }], filenameBatches: filenameBatches.length };
  return { rows: itemRows, filenameBatches: filenameBatches.length };
}
