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
type Transfer = { id: string; transaction_reference: string; document_date: string; transferred_from: string; transferred_to: string; item_code: string; description: string; product_code: string | null; batch_code: string | null; quantity: number; pallets: string[]; source_filename: string | null; created_at: string };

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const status = $<HTMLParagraphElement>("#status"), authSection = $<HTMLElement>("#auth-section"), dashboard = $<HTMLElement>("#dashboard-section"), userPanel = $<HTMLElement>("#user-panel"), userEmail = $<HTMLElement>("#user-email");
const authForm = $<HTMLFormElement>("#auth-form"), email = $<HTMLInputElement>("#email-input"), password = $<HTMLInputElement>("#password-input"), signIn = $<HTMLButtonElement>("#sign-in-button"), signUp = $<HTMLButtonElement>("#sign-up-button"), signOut = $<HTMLButtonElement>("#sign-out-button");
const pdf = $<HTMLInputElement>("#pdf-file"), pdfName = $<HTMLElement>("#pdf-name"), extract = $<HTMLButtonElement>("#extract-button"), review = $<HTMLElement>("#review-section"), reviewHead = $<HTMLTableSectionElement>("#review-table thead"), reviewBody = $<HTMLTableSectionElement>("#review-table tbody"), addRow = $<HTMLButtonElement>("#add-row-button"), save = $<HTMLButtonElement>("#save-button"), reset = $<HTMLButtonElement>("#reset-button");
const refresh = $<HTMLButtonElement>("#refresh-button"), search = $<HTMLInputElement>("#search-input"), recordsHead = $<HTMLTableSectionElement>("#records-table thead"), recordsBody = $<HTMLTableSectionElement>("#records-table tbody"), recordsDescription = $<HTMLElement>("#records-description"), recentBody = $<HTMLTableSectionElement>("#recent-table tbody");
const dateFrom = $<HTMLInputElement>("#date-from-filter"), dateTo = $<HTMLInputElement>("#date-to-filter"), batchFilter = $<HTMLInputElement>("#batch-filter"), itemFilter = $<HTMLSelectElement>("#item-filter"), clearFilters = $<HTMLButtonElement>("#clear-filters-button");
const exDateFrom = $<HTMLInputElement>("#export-date-from-filter"), exDateTo = $<HTMLInputElement>("#export-date-to-filter"), exBatch = $<HTMLInputElement>("#export-batch-filter"), exItem = $<HTMLSelectElement>("#export-item-filter"), exClear = $<HTMLButtonElement>("#export-clear-button"), exportButton = $<HTMLButtonElement>("#export-button"), exRecords = $<HTMLElement>("#export-records"), exQuantity = $<HTMLElement>("#export-quantity"), exReferences = $<HTMLElement>("#export-references"), exBody = $<HTMLTableSectionElement>("#export-preview tbody");

const ITEM_GROUPS: { group: string; items: [string, string][] }[] = [
  { group: "50 PPM", items: [["4554770121", "RF MR EXP 50PPM"], ["4554770128", "RF MR DG 50PPM"], ["4554770136", "LF X-FINE EXP 50PPM"], ["4554770130", "RF X-FINE DG 50PPM"]] },
  { group: "10 PPM", items: [["4554770148", "RF MR EXP 10PPM"], ["4554770147", "RF MR DG 10PPM"], ["4554770149", "RF X-XFINE EXP 10PPM"], ["4554770150", "RF X-XFINE DG 10PPM"]] },
];
function fillItems(select: HTMLSelectElement) {
  select.innerHTML = ""; select.append(new Option("All items", ""));
  for (const { group, items } of ITEM_GROUPS) { const optgroup = document.createElement("optgroup"); optgroup.label = group; for (const [code, name] of items) optgroup.append(new Option(`${name} — ${code}`, code)); select.append(optgroup); }
}
fillItems(itemFilter); fillItems(exItem);

let rows: ImportRow[] = [], transfers: Transfer[] = [], session: Session | null = null;
function message(text = "", kind: "" | "error" | "success" = "") { status.textContent = text; status.className = `status ${kind}`; }
function clean(value: string | undefined) { return (value ?? "").replace(/\s+/g, " ").trim(); }
function matched(text: string, pattern: RegExp) { return clean(text.match(pattern)?.[1]); }
function isoDate(value: string) { const match = value.trim().match(/^(\d{2})[-/](\d{2})[-/](\d{2}|\d{4})$/); return match ? `${match[3].length === 2 ? `20${match[3]}` : match[3]}-${match[2]}-${match[1]}` : ""; }
function normalizedDate(value: string) {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return isoDate(value);
}
function displayDate(value: string) { const [year, month, day] = normalizedDate(value).split("-"); return year ? `${day}-${month}-${year}` : ""; }

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
function parse(text: string, filename: string): ImportRow[] {
  const base = { "Transaction Reference": matched(text, /\b(GAA\s*\d{4,})\b/i).replace(/\s+/g, ""), "Document Date": matched(text, /DOCUMENT\s+DATE\s*:\s*(\d{2}-\d{2}-\d{2})/i), "Transferred From": matched(text, /SHIP\s+FROM\s*:\s*(W\d+)/i), "Transferred To": matched(text, /SHIP\s+TO\s*:\s*(W\d+)/i), "Pallets": pallets(filename) };
  const items = [...text.matchAll(/(?:^|\s)(\d{8,})\s*(.*?)\s+([A-Z0-9-]+)LOC\s+([A-Z0-9-]+)\s+([\d,]+(?:\.\d+)?)(?=\s+)/gi)];
  if (!items.length) return [{ ...base, "Item Code": "", "Description": "", "Product Code": "", "Batch Code": "", "Quantity": "" }];
  return items.map((item) => ({ ...base, "Item Code": clean(item[1]), "Description": clean(item[2]), "Product Code": clean(item[3]), "Batch Code": clean(item[4]), "Quantity": clean(item[5]) }));
}
function renderRows() {
  reviewHead.innerHTML = `<tr>${HEADERS.map((header) => `<th>${header}</th>`).join("")}<th></th></tr>`; reviewBody.innerHTML = "";
  rows.forEach((row, index) => { const tr = document.createElement("tr"); HEADERS.forEach((header) => { const td = document.createElement("td"), input = document.createElement("input"); input.value = row[header]; input.setAttribute("aria-label", `${header}, row ${index + 1}`); input.addEventListener("input", () => { rows[index][header] = input.value; }); td.append(input); tr.append(td); }); const td = document.createElement("td"), remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-row"; remove.textContent = "Remove"; remove.addEventListener("click", () => { rows.splice(index, 1); renderRows(); }); td.append(remove); tr.append(td); reviewBody.append(tr); });
}
type Filters = { query: string; dateFrom: string; dateTo: string; batch: string; item: string };
function applyFilters({ query, dateFrom, dateTo, batch, item }: Filters) {
  const q = query.trim().toLowerCase(), b = batch.trim().toLowerCase();
  const from = normalizedDate(dateFrom), to = normalizedDate(dateTo);
  return transfers.filter((transfer) => {
    const transferDate = normalizedDate(transfer.document_date);
    return (!q || [transfer.transaction_reference, transfer.item_code, transfer.description, transfer.batch_code, transfer.transferred_from, transfer.transferred_to].some((value) => value?.toLowerCase().includes(q))) && (!from || transferDate >= from) && (!to || transferDate <= to) && (!b || Boolean(transfer.batch_code?.toLowerCase().includes(b))) && (!item || transfer.item_code === item);
  });
}
const filteredTransfers = () => applyFilters({ query: search.value, dateFrom: dateFrom.value, dateTo: dateTo.value, batch: batchFilter.value, item: itemFilter.value });
const exportTransfers = () => applyFilters({ query: "", dateFrom: exDateFrom.value, dateTo: exDateTo.value, batch: exBatch.value, item: exItem.value });
function renderTransfers() {
  const shown = filteredTransfers();
  const quantity = transfers.reduce((total, transfer) => total + Number(transfer.quantity || 0), 0);
  $<HTMLElement>("#total-records").textContent = String(transfers.length); $<HTMLElement>("#total-quantity").textContent = quantity.toLocaleString(); $<HTMLElement>("#total-references").textContent = String(new Set(transfers.map((transfer) => transfer.transaction_reference)).size); $<HTMLElement>("#total-destinations").textContent = String(new Set(transfers.map((transfer) => transfer.transferred_to)).size);
  recordsDescription.textContent = `${shown.length} of ${transfers.length} records`; recordsHead.innerHTML = `<tr>${HEADERS.map((header) => `<th>${header}</th>`).join("")}<th></th></tr>`; recordsBody.innerHTML = "";
  shown.forEach((transfer) => { const tr = document.createElement("tr"); [transfer.transaction_reference, displayDate(transfer.document_date), transfer.transferred_from, transfer.transferred_to, transfer.item_code, transfer.description, transfer.product_code ?? "", transfer.batch_code ?? "", String(transfer.quantity), transfer.pallets.join(", ")].forEach((value) => { const td = document.createElement("td"); td.textContent = value; tr.append(td); }); const td = document.createElement("td"), remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-row"; remove.textContent = "Delete"; remove.addEventListener("click", () => void deleteTransfer(transfer.id)); td.append(remove); tr.append(td); recordsBody.append(tr); });
  if (!shown.length) emptyRow(recordsBody, HEADERS.length + 1, transfers.length ? "No records match your search." : "No transfers yet. Import an IWTS PDF to add your first records.");
  renderRecent(); renderExport();
}
function renderExport() {
  const list = exportTransfers();
  exRecords.textContent = String(list.length); exQuantity.textContent = list.reduce((total, transfer) => total + Number(transfer.quantity || 0), 0).toLocaleString(); exReferences.textContent = String(new Set(list.map((transfer) => transfer.transaction_reference)).size);
  exBody.innerHTML = "";
  list.slice(0, 5).forEach((transfer) => { const tr = document.createElement("tr"); [transfer.transaction_reference, displayDate(transfer.document_date), transfer.transferred_to, transfer.description, transfer.batch_code ?? "", String(transfer.quantity)].forEach((value, index) => { const td = document.createElement("td"); td.textContent = value; if (index === 5) td.className = "num"; tr.append(td); }); exBody.append(tr); });
  if (!list.length) emptyRow(exBody, 6, transfers.length ? "No records match these filters." : "No transfers yet. Import an IWTS PDF first.");
  exportButton.disabled = !list.length;
}
function emptyRow(body: HTMLTableSectionElement, columns: number, text: string) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = columns; td.className = "empty"; td.textContent = text; tr.append(td); body.append(tr); }
function renderRecent() {
  recentBody.innerHTML = "";
  transfers.slice(0, 6).forEach((transfer) => { const tr = document.createElement("tr"); [transfer.transaction_reference, displayDate(transfer.document_date), transfer.transferred_from, transfer.transferred_to, transfer.description, String(transfer.quantity)].forEach((value, index) => { const td = document.createElement("td"); td.textContent = value; if (index === 5) td.className = "num"; tr.append(td); }); recentBody.append(tr); });
  if (!transfers.length) emptyRow(recentBody, 6, "Nothing here yet. Import an IWTS PDF to see your latest transfers.");
}
const PAGES = ["overview", "import", "records", "export"];
function route() {
  const name = location.hash.replace(/^#\//, ""), current = PAGES.includes(name) ? name : "overview";
  document.querySelectorAll<HTMLElement>(".page").forEach((page) => page.classList.toggle("hidden", page.dataset.page !== current));
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((link) => { const on = link.dataset.nav === current; link.classList.toggle("active", on); if (on) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
  window.scrollTo(0, 0);
}
async function loadTransfers() { if (!supabase || !session) return; recordsDescription.textContent = "Loading records…"; const { data, error } = await supabase.from("transfers").select("*").order("document_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000); if (error) { message(`Could not load records: ${error.message}`, "error"); return; } transfers = (data ?? []) as Transfer[]; renderTransfers(); }
async function deleteTransfer(id: string) { if (!supabase || !confirm("Delete this transfer record?")) return; const { error } = await supabase.from("transfers").delete().eq("id", id); if (error) message(`Could not delete record: ${error.message}`, "error"); else await loadTransfers(); }
async function exportToExcel() {
  const list = exportTransfers();
  if (!list.length) { message("There are no records to export.", "error"); return; }
  exportButton.disabled = true; message("Building workbook…");
  try {
    const { default: ExcelJS } = await import("exceljs");
    const INK = "FF0F2A3A", SKY = "FF79BEEE", TINT = "FFEEF7FD", BAND = "FFF7FBFE", LINE = "FFD3E4F0", MUTED = "FF4D6779";
    const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
    const hair = { style: "thin" as const, color: { argb: LINE } };
    const now = new Date(), stamp = now.toISOString().slice(0, 10);
    const exportFrom = normalizedDate(exDateFrom.value), exportTo = normalizedDate(exDateTo.value);
    const filters = [exportFrom ? `Date from ${displayDate(exportFrom)}` : "", exportTo ? `Date to ${displayDate(exportTo)}` : "", exItem.value ? `Item ${exItem.selectedOptions[0]?.textContent ?? exItem.value}` : "", exBatch.value.trim() ? `Batch code contains "${exBatch.value.trim()}"` : ""].filter(Boolean);
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
      const [y, m, d] = normalizedDate(transfer.document_date).split("-").map(Number), created = new Date(transfer.created_at), row = ws.getRow(5 + index);
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
    const safeBatch = exBatch.value.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 20);
    const filenameParts = ["dcn-fg-transfers", exportFrom ? `from-${exportFrom.replaceAll("-", "")}` : "", exportTo ? `to-${exportTo.replaceAll("-", "")}` : "", safeBatch ? `batch-${safeBatch}` : "", `generated-${generatedAt}`].filter(Boolean);
    link.download = `${filenameParts.join("_")}.xlsx`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    message(`${list.length} record${list.length === 1 ? "" : "s"} exported to Excel.`, "success");
  } catch (error) {
    message(error instanceof Error ? `Could not build the workbook: ${error.message}` : "Could not build the workbook.", "error");
  } finally { renderExport(); }
}
async function saveRows() {
  const file = pdf.files?.[0]; if (!supabase || !file || !rows.length) return;
  const data = rows.map((row) => ({ transaction_reference: clean(row["Transaction Reference"]), document_date: isoDate(clean(row["Document Date"])), transferred_from: clean(row["Transferred From"]), transferred_to: clean(row["Transferred To"]), item_code: clean(row["Item Code"]), description: clean(row.Description), product_code: clean(row["Product Code"]) || null, batch_code: clean(row["Batch Code"]) || null, quantity: Number(row.Quantity.replace(/,/g, "")), pallets: clean(row.Pallets).split(",").map((value) => value.trim()).filter(Boolean), source_filename: file.name }));
  if (data.some((row) => !row.transaction_reference || !row.document_date || !row.transferred_from || !row.transferred_to || !row.item_code || !row.description || !Number.isFinite(row.quantity))) { message("Complete all required fields and use a valid document date and quantity before saving.", "error"); return; }
  save.disabled = true; message("Saving records to the shared dashboard…"); const { error } = await supabase.from("transfers").insert(data); save.disabled = false; if (error) { message(`Could not save records: ${error.message}`, "error"); return; } message(`${data.length} record${data.length === 1 ? "" : "s"} saved to the shared dashboard.`, "success"); pdf.value = ""; pdfName.textContent = "No PDF selected"; rows = []; review.classList.add("hidden"); location.hash = "#/records";
}
function showSession(next: Session | null) { session = next; const signedIn = Boolean(next); authSection.classList.toggle("hidden", signedIn); dashboard.classList.toggle("hidden", !signedIn); userPanel.classList.toggle("hidden", !signedIn); userEmail.textContent = next?.user.email ?? ""; if (signedIn) { void loadTransfers(); route(); } }

if (!supabase) { message("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to GitHub Actions secrets.", "error"); signIn.disabled = true; signUp.disabled = true; } else {
  supabase.auth.onAuthStateChange((_event, next) => showSession(next)); supabase.auth.getSession().then(({ data }) => showSession(data.session)); supabase.channel("transfers-live").on("postgres_changes", { event: "*", schema: "public", table: "transfers" }, () => void loadTransfers()).subscribe();
}
authForm.addEventListener("submit", async (event) => { event.preventDefault(); if (!supabase) return; signIn.disabled = true; message("Signing in…"); const { error } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value }); signIn.disabled = false; if (error) message(error.message, "error"); });
signUp.addEventListener("click", async () => { if (!supabase || !email.reportValidity() || !password.reportValidity()) return; signUp.disabled = true; message("Creating account…"); const { error } = await supabase.auth.signUp({ email: email.value, password: password.value, options: { emailRedirectTo: window.location.href } }); signUp.disabled = false; message(error ? error.message : "Account created. Check your email to confirm it before signing in.", error ? "error" : "success"); });
signOut.addEventListener("click", async () => { if (supabase) await supabase.auth.signOut(); });
pdf.addEventListener("change", () => { pdfName.textContent = pdf.files?.[0]?.name ?? "No PDF selected"; extract.disabled = !pdf.files?.[0]; });
extract.addEventListener("click", async () => { const file = pdf.files?.[0]; if (!file) return; try { extract.disabled = true; message("Reading IWTS PDF…"); rows = parse(await pdfText(file), file.name); renderRows(); review.classList.remove("hidden"); message("Extraction complete. Review the records before saving.", "success"); review.scrollIntoView({ block: "start" }); } catch (error) { message(error instanceof Error ? error.message : "Could not process this PDF.", "error"); } finally { extract.disabled = false; } });
addRow.addEventListener("click", () => { rows.push(Object.fromEntries(HEADERS.map((header) => [header, ""])) as ImportRow); renderRows(); }); save.addEventListener("click", () => void saveRows()); reset.addEventListener("click", () => { rows = []; review.classList.add("hidden"); message("Import discarded."); }); refresh.addEventListener("click", () => void loadTransfers()); search.addEventListener("input", renderTransfers);
for (const filter of [dateFrom, dateTo, batchFilter, itemFilter]) { filter.addEventListener("input", renderTransfers); filter.addEventListener("change", renderTransfers); }
for (const filter of [exDateFrom, exDateTo, exBatch, exItem]) { filter.addEventListener("input", renderExport); filter.addEventListener("change", renderExport); }
clearFilters.addEventListener("click", () => { dateFrom.value = ""; dateTo.value = ""; batchFilter.value = ""; itemFilter.value = ""; search.value = ""; renderTransfers(); });
exClear.addEventListener("click", () => { exDateFrom.value = ""; exDateTo.value = ""; exBatch.value = ""; exItem.value = ""; renderExport(); });
exportButton.addEventListener("click", () => void exportToExcel());
window.addEventListener("hashchange", route); route(); renderExport();
