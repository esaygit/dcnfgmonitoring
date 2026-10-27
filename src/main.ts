import { createClient, type Session } from "@supabase/supabase-js";
import * as pdfjsLib from "pdfjs-dist";
import type { Row, Worksheet } from "exceljs";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./style.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const supabase = url && key ? createClient(url, key) : null;
const HEADERS = ["Transaction Reference", "Document Date", "Transferred From", "Transferred To", "Item Code", "Description", "Product Code", "Batch Code", "Quantity", "Pallets"] as const;
type Header = (typeof HEADERS)[number];
type ImportRow = Record<Header, string>;
type Transfer = { id: string; transaction_reference: string; document_date: string; document_time: string | null; transferred_from: string; transferred_to: string; item_code: string; description: string; product_code: string | null; batch_code: string | null; quantity: number; pallets: string[]; source_filename: string | null; created_at: string };
type ParsedImport = { rows: ImportRow[]; filenameBatches: number };

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const status = $<HTMLParagraphElement>("#status"), authSection = $<HTMLElement>("#auth-section"), dashboard = $<HTMLElement>("#dashboard-section"), userPanel = $<HTMLElement>("#user-panel"), userEmail = $<HTMLElement>("#user-email");
const authForm = $<HTMLFormElement>("#auth-form"), email = $<HTMLInputElement>("#email-input"), password = $<HTMLInputElement>("#password-input"), signIn = $<HTMLButtonElement>("#sign-in-button"), signOut = $<HTMLButtonElement>("#sign-out-button");
const pdf = $<HTMLInputElement>("#pdf-file"), pdfName = $<HTMLElement>("#pdf-name"), extract = $<HTMLButtonElement>("#extract-button"), review = $<HTMLElement>("#review-section"), reviewHead = $<HTMLTableSectionElement>("#review-table thead"), reviewBody = $<HTMLTableSectionElement>("#review-table tbody"), addRow = $<HTMLButtonElement>("#add-row-button"), save = $<HTMLButtonElement>("#save-button"), reset = $<HTMLButtonElement>("#reset-button");
const dropZone = $<HTMLElement>("#drop-zone"), fileList = $<HTMLUListElement>("#file-list"), clearFiles = $<HTMLButtonElement>("#clear-files-button");
const refresh = $<HTMLButtonElement>("#refresh-button"), search = $<HTMLInputElement>("#search-input"), recordsHead = $<HTMLTableSectionElement>("#records-table thead"), recordsBody = $<HTMLTableSectionElement>("#records-table tbody"), recordsDescription = $<HTMLElement>("#records-description"), recentBody = $<HTMLTableSectionElement>("#recent-table tbody");
const reviewDuplicateWarning = $<HTMLParagraphElement>("#review-duplicate-warning"), recordsDuplicateWarning = $<HTMLParagraphElement>("#records-duplicate-warning");
const analyticsChart = $<HTMLElement>("#analytics-chart"), analyticsBody = $<HTMLTableSectionElement>("#analytics-table tbody");
const dateFrom = $<HTMLInputElement>("#date-from-filter"), dateTo = $<HTMLInputElement>("#date-to-filter"), batchFilter = $<HTMLInputElement>("#batch-filter"), itemFilter = $<HTMLSelectElement>("#item-filter"), sortFilter = $<HTMLSelectElement>("#sort-filter"), clearFilters = $<HTMLButtonElement>("#clear-filters-button");
const exportButton = $<HTMLButtonElement>("#export-button"), recordsTotalQuantity = $<HTMLElement>("#records-total-quantity"), recordsQuantityNote = $<HTMLElement>("#records-quantity-note");

const ITEM_GROUPS: { group: string; items: [string, string][] }[] = [
  { group: "50 PPM", items: [["4554770121", "RF MR EXP 50PPM"], ["4554770128", "RF MR DG 50PPM"], ["4554770136", "LF X-FINE EXP 50PPM"], ["4554770130", "RF X-FINE DG 50PPM"]] },
  { group: "10 PPM", items: [["4554770148", "RF MR EXP 10PPM"], ["4554770147", "RF MR DG 10PPM"], ["4554770149", "RF X-XFINE EXP 10PPM"], ["4554770150", "RF X-XFINE DG 10PPM"]] },
];
const GROUP_PREFIX = "group:"; // itemFilter.value is "", an item code, or "group:50 PPM" / "group:10 PPM"
function fillItems(select: HTMLSelectElement, showCode = true) {
  select.innerHTML = ""; select.append(new Option("All items", ""));
  for (const { group, items } of ITEM_GROUPS) { const optgroup = document.createElement("optgroup"); optgroup.label = group; optgroup.append(new Option(`All ${group}`, GROUP_PREFIX + group)); for (const [code, name] of items) optgroup.append(new Option(showCode ? `${name} — ${code}` : name, code)); select.append(optgroup); }
}
fillItems(itemFilter);

// Custom item dropdown so the PPM group headings are clickable (the <select> above stays as the hidden source of truth).
function buildItemPicker() {
  const host = $<HTMLElement>("#item-picker");
  type Choice = { value: string; label: string; hint: string; kind: "all" | "group" | "item" };
  const choices: Choice[] = [{ value: "", label: "All items", hint: "", kind: "all" }];
  for (const { group, items } of ITEM_GROUPS) {
    choices.push({ value: GROUP_PREFIX + group, label: group, hint: `All ${items.length} items`, kind: "group" });
    for (const [code, name] of items) choices.push({ value: code, label: name, hint: code, kind: "item" });
  }
  const button = document.createElement("button"), buttonLabel = document.createElement("span"), caret = document.createElement("span"), menu = document.createElement("div");
  button.type = "button"; button.className = "item-picker-button"; button.setAttribute("aria-haspopup", "listbox"); button.setAttribute("aria-expanded", "false"); button.setAttribute("aria-labelledby", "item-picker-label");
  buttonLabel.className = "item-picker-label"; caret.className = "item-picker-caret"; caret.setAttribute("aria-hidden", "true"); button.append(buttonLabel, caret);
  menu.className = "item-picker-menu hidden"; menu.setAttribute("role", "listbox"); menu.setAttribute("aria-label", "Item filter");
  const open = () => { menu.classList.remove("hidden"); button.setAttribute("aria-expanded", "true"); (options.find((option) => option.getAttribute("aria-selected") === "true") ?? options[0]).focus(); };
  const close = (refocus = false) => { menu.classList.add("hidden"); button.setAttribute("aria-expanded", "false"); if (refocus) button.focus(); };
  const options = choices.map((choice) => {
    const option = document.createElement("button"), text = document.createElement("span");
    option.type = "button"; option.className = `item-choice item-choice-${choice.kind}`; option.setAttribute("role", "option"); option.dataset.value = choice.value;
    text.textContent = choice.label; option.append(text);
    if (choice.hint) { const hint = document.createElement("small"); hint.textContent = choice.hint; option.append(hint); }
    option.addEventListener("click", () => { itemFilter.value = choice.value; itemFilter.dispatchEvent(new Event("change")); close(true); });
    menu.append(option); return option;
  });
  const sync = () => {
    const current = choices.find((choice) => choice.value === itemFilter.value) ?? choices[0];
    buttonLabel.textContent = current.kind === "group" ? `${current.label} — all items` : current.label;
    options.forEach((option) => option.setAttribute("aria-selected", String(option.dataset.value === current.value)));
  };
  button.addEventListener("click", () => menu.classList.contains("hidden") ? open() : close());
  button.addEventListener("keydown", (event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (menu.classList.contains("hidden")) open(); } });
  menu.addEventListener("keydown", (event) => {
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    else if (event.key === "ArrowDown") { event.preventDefault(); options[Math.min(options.length - 1, index + 1)].focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); options[Math.max(0, index - 1)].focus(); }
    else if (event.key === "Home") { event.preventDefault(); options[0].focus(); }
    else if (event.key === "End") { event.preventDefault(); options[options.length - 1].focus(); }
    else if (event.key === "Tab") close();
  });
  document.addEventListener("click", (event) => { if (!host.contains(event.target as Node)) close(); });
  host.append(button, menu); sync();
  return sync;
}
const syncItemPicker = buildItemPicker();

let rows: ImportRow[] = [], transfers: Transfer[] = [], session: Session | null = null;
const rowSource = new WeakMap<ImportRow, string>(); // which PDF each review row came from
const rowTime = new WeakMap<ImportRow, string>(); // time (HH:MM:SS) printed inside that PDF
const reviewSources = new Set<string>(); // PDFs whose rows are currently in review
let messageTimeout: ReturnType<typeof setTimeout> | undefined;
function message(text = "", kind: "" | "error" | "success" = "", duration = 5000) {
  if (messageTimeout) clearTimeout(messageTimeout);
  status.textContent = text;
  status.className = `status ${kind}`;
  if (text && duration > 0) {
    messageTimeout = setTimeout(() => {
      status.textContent = "";
      status.className = "status";
      messageTimeout = undefined;
    }, duration);
  } else {
    messageTimeout = undefined;
  }
}
function clean(value: string | undefined) { return (value ?? "").replace(/\s+/g, " ").trim(); }
function matched(text: string, pattern: RegExp) { return clean(text.match(pattern)?.[1]); }
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function normalizedDate(value: string, monthFirst = true) {
  const date = value.trim();
  const iso = date.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|T)/);
  const dayFirst = date.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
  const parts = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : dayFirst
      ? [Number(dayFirst[3].length === 2 ? `20${dayFirst[3]}` : dayFirst[3]), Number(monthFirst ? dayFirst[1] : dayFirst[2]), Number(monthFirst ? dayFirst[2] : dayFirst[1])]
      : [];
  if (parts.length !== 3) return "";
  const [year, month, day] = parts;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function isoDate(value: string) { return normalizedDate(value); }
function displayDate(value: string, monthFirst = true) { const [year, month, day] = normalizedDate(value, monthFirst).split("-"); return year ? `${month}-${day}-${year}` : ""; }

// ---- Time printed inside the PDF (used to order imported records) ----
function normalizedTime(value: string) {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (!m) return "";
  let hour = Number(m[1]);
  if (m[4]) { const pm = m[4].toUpperCase() === "PM"; hour = (hour % 12) + (pm ? 12 : 0); }
  if (hour > 23 || Number(m[2]) > 59) return "";
  return `${String(hour).padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
}
const TIME = String.raw`(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)`;
// Tries "DOCUMENT TIME: 14:32", a time right after the document date, then any "TIME: 14:32".
// If your IWTS PDFs label the time differently, add the label here.
function pdfTime(text: string) {
  return normalizedTime(
    matched(text, new RegExp(String.raw`DOCUMENT\s+TIME\s*:\s*${TIME}`, "i")) ||
    matched(text, new RegExp(String.raw`DOCUMENT\s+DATE\s*:\s*\S+\s+${TIME}`, "i")) ||
    matched(text, new RegExp(String.raw`\bTIME\s*:\s*${TIME}`, "i"))
  );
}
const reviewKey = (row: ImportRow) => {
  const date = normalizedDate(row["Document Date"]);
  return date ? `${date}T${rowTime.get(row) ?? "00:00:00"}` : "\uffff"; // undated / manual rows go last
};
// Array.sort is stable, so rows from the same PDF stay together in their original order.
function sortReviewRows() { rows.sort((a, b) => compare(reviewKey(a), reviewKey(b))); }

async function pdfText(file: File) {
  const document = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let page = 1; page <= document.numPages; page++) {
    const content = await (await document.getPage(page)).getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
  }
  return pages.join("\n");
}
function pallets(filename: string) { const part = filename.replace(/\.pdf$/i, "").match(/\bPALLETS?\s+(.+?)(?=\s+\d{8}\b|$)/i)?.[1] ?? ""; return (part.match(/\b\d{3,6}\b/g) ?? []).join(", "); }
function batchesFromFilename(filename: string) {
  const name = filename.replace(/\.pdf$/i, "");
  return [...name.matchAll(/\b([A-Z0-9]{5,}(?:-[A-Z0-9]+)*)\s+(\d+(?:\.\d+)?)\s*BAGS?\b/gi)].map((match) => ({ batch: match[1], quantity: match[2] }));
}
function parse(text: string, filename: string): ParsedImport {
  const documentDate = matched(text, /DOCUMENT\s+DATE\s*:\s*((?:\d{4}[-/]\d{1,2}[-/]\d{1,2})|(?:\d{1,2}[-/]\d{1,2}[-/]\d{2,4}))/i);
  const base = { "Transaction Reference": matched(text, /\b(GAA\s*\d{4,})\b/i).replace(/\s+/g, ""), "Document Date": normalizedDate(documentDate), "Transferred From": matched(text, /SHIP\s+FROM\s*:\s*(W\d+)/i), "Transferred To": matched(text, /SHIP\s+TO\s*:\s*(W\d+)/i), "Pallets": pallets(filename) };
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
function normalizedPallets(value: string | string[]) { return (Array.isArray(value) ? value : value.split(",")).map((pallet) => pallet.trim()).filter(Boolean); }

// ---- Possible-duplicate detection ----
// A possible duplicate needs the SAME batch code, the same quantity and at least one shared pallet.
// Different batches of one transaction often share pallets and quantities, so they are not duplicates of each other.
type DuplicateKey = { quantity: string | number; pallets: string | string[]; batch: string | null | undefined; item: string | null | undefined };
const same = (left: string | null | undefined, right: string | null | undefined) => clean(left ?? "").toLowerCase() === clean(right ?? "").toLowerCase();
function sameQuantityAndPallet(left: DuplicateKey, right: DuplicateKey) {
  if (!same(left.batch, right.batch)) return false;
  if (clean(left.item ?? "") && clean(right.item ?? "") && !same(left.item, right.item)) return false;
  const leftQuantity = String(left.quantity).replace(/,/g, "").trim(), rightQuantity = String(right.quantity).replace(/,/g, "").trim();
  if (!leftQuantity || !rightQuantity || !Number.isFinite(Number(leftQuantity)) || Number(leftQuantity) !== Number(rightQuantity)) return false;
  const rightPallets = new Set(normalizedPallets(right.pallets).map((pallet) => pallet.toLowerCase()));
  return normalizedPallets(left.pallets).some((pallet) => rightPallets.has(pallet.toLowerCase()));
}
const rowKey = (row: ImportRow): DuplicateKey => ({ quantity: row.Quantity, pallets: row.Pallets, batch: row["Batch Code"], item: row["Item Code"] });
const transferKey = (transfer: Transfer): DuplicateKey => ({ quantity: transfer.quantity, pallets: transfer.pallets, batch: transfer.batch_code, item: transfer.item_code });
function duplicateMatch(row: ImportRow, index?: number) {
  const saved = transfers.find((transfer) => sameQuantityAndPallet(rowKey(row), transferKey(transfer)));
  if (saved) return `saved record ${saved.transaction_reference || "(no reference)"}`;
  if (index === undefined) return "";
  const other = rows.findIndex((candidate, candidateIndex) => candidateIndex !== index && sameQuantityAndPallet(rowKey(row), rowKey(candidate)));
  return other >= 0 ? `import row ${other + 1}` : "";
}
function savedRecordIsDuplicate(transfer: Transfer) { return transfers.some((other) => other.id !== transfer.id && sameQuantityAndPallet(transferKey(transfer), transferKey(other))); }

function transactionReferences(values: string[]) { return [...new Set(values.map((value) => clean(value) || "not entered"))].join(", "); }
let reviewRowEls: HTMLTableRowElement[] = [];
// Light refresh used while typing: updates highlights and the warning without rebuilding the inputs.
function refreshReviewDuplicates() {
  const duplicateRows: ImportRow[] = [];
  rows.forEach((row, index) => {
    const match = duplicateMatch(row, index), tr = reviewRowEls[index];
    if (match) duplicateRows.push(row);
    if (!tr) return;
    tr.classList.toggle("possible-duplicate", Boolean(match));
    tr.title = match ? `Possible duplicate of ${match}: same batch code, quantity and pallet number.` : "";
  });
  const duplicateCount = duplicateRows.length;
  reviewDuplicateWarning.classList.toggle("hidden", duplicateCount === 0);
  reviewDuplicateWarning.textContent = duplicateCount ? `Possible duplicate${duplicateCount === 1 ? "" : "s"} found: ${duplicateCount} highlighted row${duplicateCount === 1 ? "" : "s"} match the batch code, quantity and at least one pallet of another row or saved record. Transaction Reference${duplicateRows.length === 1 ? "" : "s"}: ${transactionReferences(duplicateRows.map((row) => row["Transaction Reference"]))}. Check before saving.` : "";
}
// Full render: only when rows are added or removed.
function renderRows() {
  reviewHead.innerHTML = `<tr>${HEADERS.map((header) => `<th>${header}</th>`).join("")}<th>Source file</th><th></th></tr>`; reviewBody.innerHTML = "";
  reviewRowEls = rows.map((row, index) => {
    const tr = document.createElement("tr");
    HEADERS.forEach((header) => {
      const td = document.createElement("td"), input = document.createElement("input");
      input.value = row[header]; input.setAttribute("aria-label", `${header}, row ${index + 1}`);
      input.addEventListener("input", () => { row[header] = input.value; refreshReviewDuplicates(); });
      td.append(input); tr.append(td);
    });
    const time = rowTime.get(row), source = `${rowSource.get(row) ?? "Added manually"}${time ? ` · ${time.slice(0, 5)}` : ""}`, sourceCell = document.createElement("td");
    sourceCell.className = "source-cell"; sourceCell.textContent = source; sourceCell.title = source; tr.append(sourceCell);
    const td = document.createElement("td"), remove = document.createElement("button");
    remove.type = "button"; remove.className = "remove-row"; remove.textContent = "Remove";
    remove.addEventListener("click", () => { rows.splice(index, 1); renderRows(); });
    td.append(remove); tr.append(td); reviewBody.append(tr);
    return tr;
  });
  refreshReviewDuplicates();
}

type Filters = { query: string; dateFrom: string; dateTo: string; batch: string; item: string };
function applyFilters({ query, dateFrom, dateTo, batch, item }: Filters) {
  const groupCodes = item.startsWith(GROUP_PREFIX) ? new Set(ITEM_GROUPS.find((entry) => entry.group === item.slice(GROUP_PREFIX.length))?.items.map(([code]) => code)) : null;
  const q = query.trim().toLowerCase(), b = batch.trim().toLowerCase();
  const from = normalizedDate(dateFrom), to = normalizedDate(dateTo);
  return transfers.filter((transfer) => {
    const transferDate = normalizedDate(transfer.document_date, true);
    const withinDateRange = (!from && !to) || (Boolean(transferDate) && (!from || transferDate >= from) && (!to || transferDate <= to));
    return (!q || [transfer.transaction_reference, transfer.item_code, transfer.description, transfer.batch_code, transfer.transferred_from, transfer.transferred_to].some((value) => value?.toLowerCase().includes(q))) && withinDateRange && (!b || Boolean(transfer.batch_code?.toLowerCase().includes(b))) && (!item || (groupCodes ? groupCodes.has(transfer.item_code) : transfer.item_code === item));
  });
}

// One transaction can span several batch codes; these fields identify it.
const groupKey = (transfer: Transfer) => [transfer.transaction_reference, transfer.document_date, transfer.transferred_from, transfer.transferred_to, transfer.item_code, transfer.description, transfer.product_code ?? ""].join("\u0001");
// Sort modes: date-desc | date-asc | qty-desc | qty-asc. Date uses the document date plus the time read from the PDF.
// Quantity sorts by the transaction's total, so the batches of one transaction always stay together.
function sortTransfers(list: Transfer[], mode: string) {
  const when = (transfer: Transfer) => `${normalizedDate(transfer.document_date, true)}T${transfer.document_time ?? "00:00:00"}`;
  const totals = new Map<string, number>();
  for (const transfer of list) totals.set(groupKey(transfer), (totals.get(groupKey(transfer)) ?? 0) + Number(transfer.quantity || 0));
  const direction = mode.endsWith("asc") ? 1 : -1, byQuantity = mode.startsWith("qty");
  return [...list].sort((a, b) => {
    const primary = byQuantity ? totals.get(groupKey(a))! - totals.get(groupKey(b))! : compare(when(a), when(b));
    return primary * direction || compare(groupKey(a), groupKey(b)) || compare(a.created_at, b.created_at);
  });
}
const filteredTransfers = () => sortTransfers(applyFilters({ query: search.value, dateFrom: dateFrom.value, dateTo: dateTo.value, batch: batchFilter.value, item: itemFilter.value }), sortFilter.value);
// Pallets are merged across the batches and wrapped to PALLETS_PER_LINE per line (fixed-width column).
const PALLETS_PER_LINE = 3;
function palletLines(pallets: string[]) {
  const lines: string[] = [];
  for (let i = 0; i < pallets.length; i += PALLETS_PER_LINE) lines.push(pallets.slice(i, i + PALLETS_PER_LINE).join(", "));
  return lines.map((line, index) => (index < lines.length - 1 ? `${line},` : line)).join("\n");
}
// Rows that share every other identifying value are shown once;
// batch code and quantity are per-batch, so they are stacked one line per batch (same order); pallets are merged and wrapped 3 per line.
function groupTransfers(list: Transfer[]) {
  const groups = new Map<string, Transfer[]>();
  for (const transfer of list) {
    const key = groupKey(transfer);
    const group = groups.get(key);
    if (group) group.push(transfer); else groups.set(key, [transfer]);
  }
  return [...groups.values()];
}
const stackLines = (members: Transfer[], pick: (transfer: Transfer) => string) => members.map((transfer) => pick(transfer) || (members.length > 1 ? "—" : "")).join("\n");
function renderTransfers() {
  syncItemPicker();
  const shown = filteredTransfers();
  const quantity = transfers.reduce((total, transfer) => total + Number(transfer.quantity || 0), 0);
  $<HTMLElement>("#total-records").textContent = String(transfers.length); $<HTMLElement>("#total-quantity").textContent = quantity.toLocaleString(); $<HTMLElement>("#total-references").textContent = String(new Set(transfers.map((transfer) => transfer.transaction_reference)).size); $<HTMLElement>("#total-destinations").textContent = String(new Set(transfers.map((transfer) => transfer.transferred_to)).size);
  const duplicateRows = shown.filter(savedRecordIsDuplicate);
  const duplicateCount = duplicateRows.length;
  recordsDuplicateWarning.classList.toggle("hidden", duplicateCount === 0);
  recordsDuplicateWarning.textContent = duplicateCount ? `Possible duplicate${duplicateCount === 1 ? "" : "s"} found: ${duplicateCount} highlighted batch line${duplicateCount === 1 ? "" : "s"} share the same batch code, quantity and at least one pallet with another saved record. Transaction Reference${duplicateRows.length === 1 ? "" : "s"}: ${transactionReferences(duplicateRows.map((transfer) => transfer.transaction_reference))}.` : "";
  const groups = groupTransfers(shown); recordsDescription.textContent = `${shown.length} of ${transfers.length} records`; recordsHead.innerHTML = `<tr>${HEADERS.map((header) => `<th>${header}</th>`).join("")}</tr>`; recordsBody.innerHTML = "";
  groups.forEach((members) => {
    const [first] = members, tr = document.createElement("tr");
    const duplicateIds = new Set(members.filter(savedRecordIsDuplicate).map((transfer) => transfer.id));
    if (duplicateIds.size) tr.className = "has-duplicate";
    const stackCell = (td: HTMLTableCellElement, pick: (transfer: Transfer) => string) => {
      td.className = "stacked";
      members.forEach((transfer) => {
        const line = document.createElement("span");
        line.className = duplicateIds.has(transfer.id) ? "stack-line dup-line" : "stack-line";
        if (duplicateIds.has(transfer.id)) line.title = "Possible duplicate: another saved record has the same batch code, quantity and pallet.";
        line.textContent = pick(transfer) || (members.length > 1 ? "—" : "");
        td.append(line);
      });
    };
    [first.transaction_reference, displayDate(first.document_date, true), first.transferred_from, first.transferred_to, first.item_code, first.description, first.product_code ?? "", "", "", palletLines([...new Set(members.flatMap((transfer) => transfer.pallets))])].forEach((value, index) => {
      const td = document.createElement("td");
      if (index === 7) stackCell(td, (transfer) => transfer.batch_code ?? "");
      else if (index === 8) stackCell(td, (transfer) => String(transfer.quantity));
      else {
        td.textContent = value;
        if (index === 9) td.className = "stacked";
        if (index === 0 && duplicateIds.size) { const badge = document.createElement("span"); badge.className = "dup-badge"; badge.textContent = "Possible duplicate"; badge.title = "A batch in this transaction matches another saved record (same batch code, quantity and pallet)."; td.append(badge); }
      }
      tr.append(td);
    });
    recordsBody.append(tr);
  });
  if (!shown.length) emptyRow(recordsBody, HEADERS.length, transfers.length ? "No records match your search." : "No transfers yet. Import an IWTS PDF to add your first records.");
  const shownQuantity = shown.reduce((total, transfer) => total + Number(transfer.quantity || 0), 0), isFiltered = Boolean(search.value.trim() || dateFrom.value || dateTo.value || batchFilter.value.trim() || itemFilter.value);
  recordsTotalQuantity.textContent = shownQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 });
  recordsQuantityNote.textContent = isFiltered ? `${shown.length} of ${transfers.length} records match the current search and filters` : `All ${transfers.length} record${transfers.length === 1 ? "" : "s"}`;
  exportButton.disabled = !shown.length;
  exportButton.title = shown.length ? `Download the ${shown.length} record${shown.length === 1 ? "" : "s"} matching the current search and filters as an Excel workbook` : "No records to download";
  renderRecent(); renderAnalytics();
}
const DONUT_COLORS = ["#1f6fa5", "#79beee", "#3fb6a8", "#f2b84b"];
const GROUP_CLASS: Record<string, string> = { "10 PPM": "ppm-10", "50 PPM": "ppm-50" };
const GROUP_OF = new Map<string, string>(ITEM_GROUPS.flatMap(({ group, items }) => items.map(([code]) => [code, group] as [string, string])));
const fmt = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const pct = (part: number, whole: number) => whole > 0 ? `${(part / whole * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : "0%";
function renderDonut(container: HTMLElement, group: string, quantities: Map<string, number>) {
  const entry = ITEM_GROUPS.find((candidate) => candidate.group === group)!;
  const slices = entry.items.map(([code, name], index) => ({ code, name, quantity: quantities.get(code) ?? 0, color: DONUT_COLORS[index % DONUT_COLORS.length] }));
  const total = slices.reduce((sum, slice) => sum + slice.quantity, 0);
  const radius = 72, circumference = 2 * Math.PI * radius, active = slices.filter((slice) => slice.quantity > 0).length, gap = active > 1 ? 3 : 0;
  let offset = 0;
  const arcs = slices.filter((slice) => slice.quantity > 0).map((slice) => {
    const length = slice.quantity / total * circumference, visible = Math.max(length - gap, 0.01);
    const arc = `<circle class="donut-arc" cx="100" cy="100" r="${radius}" fill="none" stroke="${slice.color}" stroke-width="26" stroke-dasharray="${visible} ${circumference - visible}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)"><title>${slice.name}: ${fmt(slice.quantity)} (${pct(slice.quantity, total)})</title></circle>`;
    offset += length;
    return arc;
  }).join("");
  const legend = slices.map((slice) => `<li class="${slice.quantity ? "" : "is-zero"}"><i style="background:${slice.color}"></i><span class="legend-name"><strong>${slice.name}</strong><small>${slice.code}</small></span><span class="legend-value"><strong>${fmt(slice.quantity)}</strong><small>${pct(slice.quantity, total)}</small></span></li>`).join("");
  container.innerHTML = `<div class="donut-figure"><svg viewBox="0 0 200 200" class="donut-svg" role="img" aria-label="${group} quantity by item code, total ${fmt(total)}"><circle cx="100" cy="100" r="${radius}" fill="none" stroke="var(--tint)" stroke-width="26"/>${arcs}</svg><div class="donut-center"><strong>${fmt(total)}</strong><span>${total ? "Total quantity" : "No data yet"}</span></div></div><ul class="donut-legend">${legend}</ul>`;
}
function renderAnalytics() {
  const byItem = new Map<string, { description: string; records: number; quantity: number; batches: Set<string>; pallets: Set<string>; destinations: Set<string>; latestDate: string }>();
  for (const transfer of transfers) {
    const code = clean(transfer.item_code);
    if (!code) continue;
    const item = byItem.get(code) ?? { description: clean(transfer.description), records: 0, quantity: 0, batches: new Set<string>(), pallets: new Set<string>(), destinations: new Set<string>(), latestDate: "" };
    item.records++;
    item.quantity += Number.isFinite(Number(transfer.quantity)) ? Number(transfer.quantity) : 0;
    if (!item.description && transfer.description) item.description = clean(transfer.description);
    if (transfer.batch_code) item.batches.add(transfer.batch_code.trim());
    normalizedPallets(transfer.pallets).forEach((pallet) => item.pallets.add(pallet));
    if (transfer.transferred_to) item.destinations.add(transfer.transferred_to);
    const date = normalizedDate(transfer.document_date, true);
    if (date > item.latestDate) item.latestDate = date;
    byItem.set(code, item);
  }
  const items = [...byItem].sort((left, right) => right[1].quantity - left[1].quantity || left[0].localeCompare(right[0]));
  const totalQuantity = items.reduce((sum, [, item]) => sum + item.quantity, 0);
  const largestItem = items[0];
  $<HTMLElement>("#analytics-item-count").textContent = String(items.length);
  $<HTMLElement>("#analytics-total-quantity").textContent = totalQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 });
  $<HTMLElement>("#analytics-largest-item").textContent = largestItem ? largestItem[0] : "—";
  $<HTMLElement>("#analytics-largest-desc").textContent = largestItem ? `${largestItem[1].description || "No description"} · ${fmt(largestItem[1].quantity)}` : "\u00a0";
  const quantities = new Map(items.map(([code, item]) => [code, item.quantity] as [string, number]));
  const groupTotal = (group: string) => items.reduce((sum, [code, item]) => GROUP_OF.get(code) === group ? sum + item.quantity : sum, 0);
  const ppm10 = groupTotal("10 PPM"), ppm50 = groupTotal("50 PPM");
  $<HTMLElement>("#analytics-ppm10-quantity").textContent = fmt(ppm10);
  $<HTMLElement>("#analytics-ppm50-quantity").textContent = fmt(ppm50);
  $<HTMLElement>("#analytics-ppm10-share").textContent = `${pct(ppm10, totalQuantity)} of total`;
  $<HTMLElement>("#analytics-ppm50-share").textContent = `${pct(ppm50, totalQuantity)} of total`;
  renderDonut($<HTMLElement>("#analytics-donut-10"), "10 PPM", quantities);
  renderDonut($<HTMLElement>("#analytics-donut-50"), "50 PPM", quantities);
  analyticsChart.innerHTML = "";
  analyticsBody.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted analytics-empty";
    empty.textContent = "No item-code analytics yet. Import records to see the breakdown.";
    analyticsChart.append(empty);
    emptyRow(analyticsBody, 9, "No saved records with an item code.");
    return;
  }
  const maximum = Math.max(...items.map(([, item]) => item.quantity));
  for (const [code, item] of items) {
    const chartRow = document.createElement("div");
    chartRow.className = "analytics-bar-row";
    const label = document.createElement("div");
    label.className = "analytics-bar-label";
    const name = document.createElement("strong");
    name.textContent = code;
    const description = document.createElement("span");
    description.textContent = item.description || "No description";
    label.append(name, description);
    const track = document.createElement("div");
    track.className = "analytics-bar-track";
    track.setAttribute("role", "img");
    track.setAttribute("aria-label", `${code}: ${item.quantity.toLocaleString()} total quantity`);
    const bar = document.createElement("span");
    bar.className = `analytics-bar ${GROUP_CLASS[GROUP_OF.get(code) ?? ""] ?? ""}`;
    bar.style.width = `${maximum > 0 ? item.quantity / maximum * 100 : 0}%`;
    track.append(bar);
    const value = document.createElement("strong");
    value.className = "analytics-bar-value";
    value.textContent = item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 });
    chartRow.append(label, track, value);
    analyticsChart.append(chartRow);

    const tr = document.createElement("tr");
    const cells = [
      code,
      item.description || "—",
      String(item.records),
      item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      (item.quantity / item.records).toLocaleString(undefined, { maximumFractionDigits: 2 }),
      String(item.batches.size),
      String(item.pallets.size),
      String(item.destinations.size),
      item.latestDate ? displayDate(item.latestDate) : "—",
    ];
    cells.forEach((text, index) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (index >= 2 && index <= 7) td.className = "num";
      tr.append(td);
    });
    analyticsBody.append(tr);
  }
}
function emptyRow(body: HTMLTableSectionElement, columns: number, text: string) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = columns; td.className = "empty"; td.textContent = text; tr.append(td); body.append(tr); }
function renderRecent() {
  recentBody.innerHTML = "";
  // "Latest" always means newest first, regardless of the Records sort setting.
  groupTransfers(sortTransfers(transfers, "date-desc")).slice(0, 6).forEach((members) => {
    const [first] = members, tr = document.createElement("tr");
    [first.transaction_reference, displayDate(first.document_date, true), first.transferred_from, first.transferred_to, first.description, stackLines(members, (transfer) => String(transfer.quantity))].forEach((value, index) => { const td = document.createElement("td"); td.textContent = value; if (index === 5) td.className = "num stacked"; tr.append(td); });
    recentBody.append(tr);
  });
  if (!transfers.length) emptyRow(recentBody, 6, "Nothing here yet. Import an IWTS PDF to see your latest transfers.");
}
const PAGES = ["overview", "analytics", "import", "records"];
function route() {
  const hash = location.hash.replace(/^#\//, ""), name = hash === "export" ? "records" : hash, current = PAGES.includes(name) ? name : "overview"; // #/export (old bookmarks) now opens Records
  document.querySelectorAll<HTMLElement>(".page").forEach((page) => page.classList.toggle("hidden", page.dataset.page !== current));
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((link) => { const on = link.dataset.nav === current; link.classList.toggle("active", on); if (on) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
  window.scrollTo(0, 0);
}
async function loadTransfers() {
  if (!supabase || !session) return;
  recordsDescription.textContent = "Loading records…";
  const { data, error } = await supabase.from("transfers").select("*").order("document_date", { ascending: false }).order("document_time", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1000);
  if (error) { message(`Could not load records: ${error.message}`, "error"); return; }
  transfers = (data ?? []) as Transfer[];
  renderTransfers();
}
// Several rows inserted at once fire several realtime events; reload only once.
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleReload() { if (reloadTimer) clearTimeout(reloadTimer); reloadTimer = setTimeout(() => void loadTransfers(), 500); }
async function exportToExcel() {
  const list = filteredTransfers(); // exactly what the Records tab is showing (search + filters + sort)
  if (!list.length) { message("There are no records to export.", "error"); return; }
  exportButton.disabled = true; message("Building workbook…", "", 0);
  try {
    const { default: ExcelJS } = await import("exceljs");
    const INK = "FF0F2A3A", SKY = "FF79BEEE", TINT = "FFEEF7FD", BAND = "FFF7FBFE", LINE = "FFD3E4F0", MUTED = "FF4D6779";
    const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
    const hair = { style: "thin" as const, color: { argb: LINE } };
    const now = new Date(), stamp = now.toISOString().slice(0, 10);
    const exportFrom = normalizedDate(dateFrom.value), exportTo = normalizedDate(dateTo.value);
    const itemName = itemFilter.value.startsWith(GROUP_PREFIX) ? `${itemFilter.value.slice(GROUP_PREFIX.length)} (all items)` : ITEM_GROUPS.flatMap((entry) => entry.items).find(([code]) => code === itemFilter.value)?.[1] ?? itemFilter.value;
    const filters = [search.value.trim() ? `Search contains "${search.value.trim()}"` : "", exportFrom ? `Date from ${displayDate(exportFrom)}` : "", exportTo ? `Date to ${displayDate(exportTo)}` : "", itemFilter.value ? `Item ${itemName}` : "", batchFilter.value.trim() ? `Batch code contains "${batchFilter.value.trim()}"` : ""].filter(Boolean);
    const filterText = filters.length ? filters.join("; ") : "none (all records)";
    const total = list.reduce((sum, transfer) => sum + Number(transfer.quantity || 0), 0);
    const whole = list.every((transfer) => Number.isInteger(Number(transfer.quantity)));
    const quantityFormat = whole ? "#,##0" : "#,##0.00";

    const title = (ws: Worksheet, text: string, sub: string, last: number) => {
      ws.mergeCells(1, 1, 1, last); ws.getCell(1, 1).value = text; ws.getCell(1, 1).font = { size: 18, bold: true, color: { argb: INK } }; ws.getCell(1, 1).alignment = { vertical: "middle" }; ws.getRow(1).height = 34;
      ws.mergeCells(2, 1, 2, last); ws.getCell(2, 1).value = sub; ws.getCell(2, 1).font = { size: 10, color: { argb: MUTED } }; ws.getRow(2).height = 20;
    };
    const header = (row: Row, count: number, right: number[] = [], center: number[] = []) => {
      row.height = 28;
      for (let col = 1; col <= count; col++) { const cell = row.getCell(col); cell.fill = fill(SKY); cell.font = { bold: true, color: { argb: INK } }; cell.alignment = { vertical: "middle", horizontal: right.includes(col) ? "right" : center.includes(col) ? "center" : "left", indent: 1 }; cell.border = { bottom: { style: "medium", color: { argb: INK } } }; }
    };

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "DCN FG Monitoring"; workbook.created = now;

    // Transfers sheet
    const ws = workbook.addWorksheet("Transfers", { properties: { tabColor: { argb: SKY } }, views: [{ state: "frozen", xSplit: 1, ySplit: 4, showGridLines: false }] });
    const cols: [string, number][] = [["Transaction Reference", 24], ["Document Date", 16], ["Transferred From", 18], ["Transferred To", 18], ["Item Code", 16], ["Description", 36], ["Product Code", 16], ["Batch Code", 18], ["Quantity", 14], ["Pallets", 20], ["Source File", 42], ["Created At", 20]];
    ws.columns = cols.map(([, width]) => ({ width }));
    title(ws, "DCN FG transfer register", `Generated ${displayDate(stamp)}. Filters: ${filterText}. ${list.length} record${list.length === 1 ? "" : "s"}.`, cols.length);
    const head = ws.getRow(4); head.values = cols.map(([name]) => name); header(head, cols.length, [9], [2]);
    list.forEach((transfer, index) => {
      const [y, m, d] = normalizedDate(transfer.document_date, true).split("-").map(Number), created = new Date(transfer.created_at), row = ws.getRow(5 + index);
      row.values = [transfer.transaction_reference, new Date(Date.UTC(y, m - 1, d)), transfer.transferred_from, transfer.transferred_to, transfer.item_code, transfer.description, transfer.product_code ?? "", transfer.batch_code ?? "", Number(transfer.quantity), transfer.pallets.join(", "), transfer.source_filename ?? "", new Date(created.getTime() - created.getTimezoneOffset() * 60000)];
      row.height = 22;
      for (let col = 1; col <= cols.length; col++) { const cell = row.getCell(col); cell.border = { bottom: hair }; cell.font = { color: { argb: INK } }; cell.alignment = { vertical: "middle", horizontal: col === 9 ? "right" : col === 2 ? "center" : "left", indent: col === 9 || col === 2 ? 0 : 1 }; if (index % 2) cell.fill = fill(BAND); }
      row.getCell(2).numFmt = "dd-mm-yyyy"; row.getCell(9).numFmt = quantityFormat; row.getCell(12).numFmt = "dd-mm-yyyy hh:mm";
    });
    const last = 4 + list.length, totalRow = ws.getRow(last + 1);
    totalRow.height = 26; totalRow.getCell(1).value = "Total"; totalRow.getCell(9).value = { formula: `SUM(I5:I${last})`, result: total };
    for (let col = 1; col <= cols.length; col++) { const cell = totalRow.getCell(col); cell.fill = fill(TINT); cell.font = { bold: true, color: { argb: INK } }; cell.border = { top: { style: "medium", color: { argb: INK } } }; cell.alignment = { vertical: "middle", horizontal: col === 9 ? "right" : "left", indent: col === 9 ? 0 : 1 }; }
    totalRow.getCell(9).numFmt = quantityFormat;
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: last, column: cols.length } };
    ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "4:4" };

    // Summary sheet
    const sm = workbook.addWorksheet("Summary", { properties: { tabColor: { argb: SKY } }, views: [{ showGridLines: false }] });
    sm.columns = [{ width: 22 }, { width: 38 }, { width: 12 }, { width: 16 }];
    title(sm, "Summary", `Based on the ${list.length} exported record${list.length === 1 ? "" : "s"}. Filters: ${filterText}.`, 4);
    const block = (label: string, names: string[], data: (string | number)[][], start: number) => {
      sm.getCell(start, 1).value = label; sm.getCell(start, 1).font = { bold: true, size: 12, color: { argb: INK } };
      const h = sm.getRow(start + 1); h.values = names; header(h, 4, [3, 4]);
      data.forEach((values, index) => { const row = sm.getRow(start + 2 + index); row.values = values; row.height = 22; for (let col = 1; col <= 4; col++) { const cell = row.getCell(col); cell.border = { bottom: hair }; cell.font = { color: { argb: INK } }; cell.alignment = { vertical: "middle", horizontal: col >= 3 ? "right" : "left", indent: col >= 3 ? 0 : 1 }; if (index % 2) cell.fill = fill(BAND); } row.getCell(3).numFmt = "#,##0"; row.getCell(4).numFmt = quantityFormat; });
      const first = start + 2, end = start + 1 + data.length, tr = sm.getRow(end + 1);
      tr.height = 26; tr.getCell(1).value = "Total"; tr.getCell(3).value = { formula: `SUM(C${first}:C${end})`, result: list.length }; tr.getCell(4).value = { formula: `SUM(D${first}:D${end})`, result: total };
      for (let col = 1; col <= 4; col++) { const cell = tr.getCell(col); cell.fill = fill(TINT); cell.font = { bold: true, color: { argb: INK } }; cell.border = { top: { style: "medium", color: { argb: INK } } }; cell.alignment = { vertical: "middle", horizontal: col >= 3 ? "right" : "left", indent: col >= 3 ? 0 : 1 }; }
      tr.getCell(3).numFmt = "#,##0"; tr.getCell(4).numFmt = quantityFormat;
      return end + 4;
    };
    const byItem = new Map<string, { description: string; records: number; quantity: number }>(), byDestination = new Map<string, { from: Set<string>; records: number; quantity: number }>();
    for (const transfer of list) {
      const item = byItem.get(transfer.item_code) ?? { description: transfer.description, records: 0, quantity: 0 }; item.records++; item.quantity += Number(transfer.quantity || 0); byItem.set(transfer.item_code, item);
      const destination = byDestination.get(transfer.transferred_to) ?? { from: new Set<string>(), records: 0, quantity: 0 }; destination.from.add(transfer.transferred_from); destination.records++; destination.quantity += Number(transfer.quantity || 0); byDestination.set(transfer.transferred_to, destination);
    }
    const next = block("By item", ["Item Code", "Description", "Records", "Quantity"], [...byItem].sort((a, b) => b[1].quantity - a[1].quantity).map(([code, v]) => [code, v.description, v.records, v.quantity]), 4);
    block("By destination", ["Transferred To", "Transferred From", "Records", "Quantity"], [...byDestination].sort((a, b) => b[1].quantity - a[1].quantity).map(([to, v]) => [to, [...v.from].join(", "), v.records, v.quantity]), next);
    sm.pageSetup = { orientation: "portrait", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

    const buffer = await workbook.xlsx.writeBuffer();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const timestampParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now).reduce<Record<string, string>>((parts, part) => ({ ...parts, [part.type]: part.value }), {});
    const generatedAt = `${timestampParts.year}${timestampParts.month}${timestampParts.day}-${timestampParts.hour}${timestampParts.minute}`;
    const safeBatch = batchFilter.value.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 20);
    const filenameParts = ["dcn-fg-transfers", exportFrom ? `from-${exportFrom.replaceAll("-", "")}` : "", exportTo ? `to-${exportTo.replaceAll("-", "")}` : "", safeBatch ? `batch-${safeBatch}` : "", `generated-${generatedAt}`].filter(Boolean);
    link.download = `${filenameParts.join("_")}.xlsx`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    message(`${list.length} record${list.length === 1 ? "" : "s"} exported to Excel.`, "success");
  } catch (error) {
    message(error instanceof Error ? `Could not build the workbook: ${error.message}` : "Could not build the workbook.", "error");
  } finally { exportButton.disabled = !filteredTransfers().length; }
}
async function saveRows() {
  if (!supabase || !rows.length) return;
  const data = rows.map((row) => ({ transaction_reference: clean(row["Transaction Reference"]), document_date: isoDate(clean(row["Document Date"])), document_time: rowTime.get(row) ?? null, transferred_from: clean(row["Transferred From"]), transferred_to: clean(row["Transferred To"]), item_code: clean(row["Item Code"]), description: clean(row.Description), product_code: clean(row["Product Code"]) || null, batch_code: clean(row["Batch Code"]) || null, quantity: Number(row.Quantity.replace(/,/g, "")), pallets: clean(row.Pallets).split(",").map((value) => value.trim()).filter(Boolean), source_filename: rowSource.get(row) ?? "manual entry" }));
  if (data.some((row) => !row.transaction_reference || !row.document_date || !row.transferred_from || !row.transferred_to || !row.item_code || !row.description || !Number.isFinite(row.quantity))) { message("Complete all required fields and use a valid document date and quantity before saving.", "error"); return; }
  save.disabled = true;
  message("Saving records to the shared dashboard…", "", 0);
  let saveError: string | undefined;
  try {
    const { error } = await supabase.from("transfers").insert(data);
    saveError = error?.message;
  } catch (error) {
    saveError = error instanceof Error ? error.message : "Unexpected error.";
  } finally {
    save.disabled = false;
  }
  if (saveError) { message(`Could not save records: ${saveError}`, "error"); return; }
  rows = []; reviewSources.clear(); review.classList.add("hidden"); renderQueue(); message(`${data.length} record${data.length === 1 ? "" : "s"} saved to the shared dashboard.`, "success"); await loadTransfers(); location.hash = "#/records";
}
function showSession(next: Session | null) { session = next; const signedIn = Boolean(next); authSection.classList.toggle("hidden", signedIn); dashboard.classList.toggle("hidden", !signedIn); userPanel.classList.toggle("hidden", !signedIn); userEmail.textContent = next?.user.email ?? ""; if (signedIn) { void loadTransfers(); route(); } }

if (!supabase) { message("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to GitHub Actions secrets.", "error"); signIn.disabled = true; } else {
  supabase.auth.onAuthStateChange((_event, next) => showSession(next)); supabase.auth.getSession().then(({ data }) => showSession(data.session)); supabase.channel("transfers-live").on("postgres_changes", { event: "*", schema: "public", table: "transfers" }, scheduleReload).subscribe();
}
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  signIn.disabled = true;
  message("Signing in…", "", 0);
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value });
    message(error ? error.message : "", error ? "error" : "");
  } catch (error) {
    message(error instanceof Error ? error.message : "Could not sign in. Please try again.", "error");
  } finally {
    signIn.disabled = false;
  }
});
signOut.addEventListener("click", async () => {
  if (!supabase) return;
  signOut.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      message(`Could not sign out: ${error.message}`, "error");
      return;
    }
    showSession(null);
    message("Signed out successfully.", "success");
  } catch (error) {
    message(error instanceof Error ? `Could not sign out: ${error.message}` : "Could not sign out. Please try again.", "error");
  } finally {
    signOut.disabled = false;
  }
});
// ---- Multi-file upload: choose or drag & drop several PDFs, extract them together ----
type QueueItem = { file: File; state: "queued" | "reading" | "failed"; error?: string };
let queue: QueueItem[] = [], extracting = false;
const fileKey = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;
const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);
const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
function renderQueue() {
  fileList.innerHTML = "";
  queue.forEach((item) => {
    const li = document.createElement("li"), name = document.createElement("span"), size = document.createElement("span"), state = document.createElement("span"), remove = document.createElement("button");
    name.className = "file-name"; name.textContent = item.file.name; name.title = item.file.name;
    size.className = "file-size"; size.textContent = formatSize(item.file.size);
    state.className = `file-state ${item.state}`; state.textContent = item.state === "reading" ? "Reading…" : item.state === "failed" ? `Failed: ${item.error ?? "could not read"}` : "Ready"; state.title = item.error ?? "";
    remove.type = "button"; remove.className = "file-remove secondary"; remove.textContent = "Remove"; remove.setAttribute("aria-label", `Remove ${item.file.name}`); remove.disabled = item.state === "reading";
    remove.addEventListener("click", () => { queue = queue.filter((entry) => entry !== item); renderQueue(); });
    li.append(name, size, state, remove); fileList.append(li);
  });
  fileList.classList.toggle("hidden", !queue.length); clearFiles.classList.toggle("hidden", !queue.length);
  clearFiles.disabled = extracting;
  pdfName.textContent = queue.length ? `${queue.length} PDF${queue.length === 1 ? "" : "s"} ready to extract` : "No PDFs selected";
  extract.textContent = queue.length > 1 ? `Extract ${queue.length} PDFs` : "Extract records";
  extract.disabled = extracting || !queue.length;
}
function addFiles(files: File[]) {
  const known = new Set([...queue.map((item) => fileKey(item.file)), ...reviewSources]);
  let added = 0, ignored = 0, repeated = 0;
  for (const file of files) {
    if (!isPdf(file)) { ignored++; continue; }
    if (known.has(fileKey(file))) { repeated++; continue; }
    known.add(fileKey(file)); queue.push({ file, state: "queued" }); added++;
  }
  renderQueue();
  const notes = [ignored && `${ignored} non-PDF file${ignored === 1 ? "" : "s"} ignored`, repeated && `${repeated} already added`].filter(Boolean);
  if (notes.length) message(notes.join(" · "), added ? "" : "error");
}
pdf.addEventListener("change", () => { addFiles(Array.from(pdf.files ?? [])); pdf.value = ""; }); // reset so the same file can be picked again
clearFiles.addEventListener("click", () => { if (extracting) return; queue = []; renderQueue(); });
let dragDepth = 0;
const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
dropZone.addEventListener("dragenter", (event) => { if (!hasFiles(event)) return; event.preventDefault(); dragDepth++; dropZone.classList.add("dragging"); });
dropZone.addEventListener("dragover", (event) => { if (!hasFiles(event)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; });
dropZone.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropZone.classList.remove("dragging"); });
dropZone.addEventListener("drop", (event) => { if (!hasFiles(event)) return; event.preventDefault(); dragDepth = 0; dropZone.classList.remove("dragging"); addFiles(Array.from(event.dataTransfer?.files ?? [])); });
// A file dropped outside the zone would make the browser open the PDF and leave the app.
for (const type of ["dragover", "drop"]) window.addEventListener(type, (event) => { if (hasFiles(event as DragEvent)) event.preventDefault(); });
extract.addEventListener("click", async () => {
  if (extracting) return;
  const batch = queue.filter((item) => item.state !== "reading");
  if (!batch.length) return;
  extracting = true; let added = 0, done = 0, failed = 0, split = 0, lastError = "";
  for (const [position, item] of batch.entries()) {
    item.state = "reading"; item.error = undefined; renderQueue();
    message(`Reading PDF ${position + 1} of ${batch.length}: ${item.file.name}…`, "", 0);
    try {
      const text = await pdfText(item.file);
      const parsed = parse(text, item.file.name), time = pdfTime(text);
      parsed.rows.forEach((row) => { rowSource.set(row, item.file.name); if (time) rowTime.set(row, time); });
      rows.push(...parsed.rows); reviewSources.add(fileKey(item.file));
      added += parsed.rows.length; done++; if (parsed.filenameBatches > 1) split++;
      queue = queue.filter((entry) => entry !== item);
    } catch (error) {
      item.state = "failed"; item.error = lastError = error instanceof Error ? error.message : "Could not process this PDF."; failed++;
    }
    renderQueue();
  }
  extracting = false; renderQueue();
  if (added) { sortReviewRows(); renderRows(); review.classList.remove("hidden"); } // oldest first, by the time printed in each PDF
  if (!added) { message(failed === 1 ? lastError : `None of the ${failed} PDFs could be processed.`, "error"); return; }
  const parts = [`${added} record${added === 1 ? "" : "s"} added from ${done} PDF${done === 1 ? "" : "s"}.`];
  if (split) parts.push(`${split} file${split === 1 ? "" : "s"} had several batch entries in the filename; check the split records.`);
  if (failed) parts.push(`${failed} PDF${failed === 1 ? "" : "s"} failed and ${failed === 1 ? "is" : "are"} still listed above.`);
  parts.push("Review the records before saving.");
  message(parts.join(" "), failed ? "error" : "success"); review.scrollIntoView({ block: "start" });
});
addRow.addEventListener("click", () => { rows.push(Object.fromEntries(HEADERS.map((header) => [header, ""])) as ImportRow); renderRows(); }); save.addEventListener("click", () => void saveRows()); reset.addEventListener("click", () => { rows = []; reviewSources.clear(); review.classList.add("hidden"); message("Import discarded."); }); refresh.addEventListener("click", () => void loadTransfers()); search.addEventListener("input", renderTransfers);
for (const filter of [dateFrom, dateTo, batchFilter, itemFilter, sortFilter]) { filter.addEventListener("input", renderTransfers); filter.addEventListener("change", renderTransfers); }
clearFilters.addEventListener("click", () => { dateFrom.value = ""; dateTo.value = ""; batchFilter.value = ""; itemFilter.value = ""; sortFilter.value = "date-desc"; search.value = ""; renderTransfers(); });
exportButton.addEventListener("click", () => void exportToExcel());
document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#/"]') : null;
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (link.target && link.target !== "_self")) return;
  event.preventDefault();
  if (location.hash !== link.hash) history.pushState(null, "", link.hash);
  route();
}, true);
window.addEventListener("popstate", route);
window.addEventListener("hashchange", route);
route();
renderQueue();
