import { $ } from "../dom";
import { HEADERS, type ImportRow } from "../constants";
import { checkDuplicates, insertTransfers } from "../api";
import { parse, pdfTime } from "../parse";
import { descriptionForItemCode, invalidImportFields, localDuplicateIndex, sortReviewRows, toProbe } from "../importRows";
import type { NewTransfer } from "../types";
import { clean, debounce, normalizedDate, transactionReferences } from "../utils";
import { message } from "./toast";

const pdf = $<HTMLInputElement>("#pdf-file"), pdfName = $<HTMLElement>("#pdf-name"), extract = $<HTMLButtonElement>("#extract-button");
const review = $<HTMLElement>("#review-section"), reviewHead = $<HTMLTableSectionElement>("#review-table thead"), reviewBody = $<HTMLTableSectionElement>("#review-table tbody");
const addRow = $<HTMLButtonElement>("#add-row-button"), save = $<HTMLButtonElement>("#save-button"), reset = $<HTMLButtonElement>("#reset-button");
const dropZone = $<HTMLElement>("#drop-zone"), fileList = $<HTMLUListElement>("#file-list"), clearFiles = $<HTMLButtonElement>("#clear-files-button");
const reviewDuplicateWarning = $<HTMLParagraphElement>("#review-duplicate-warning");
const pdfPreviewPanel = $<HTMLElement>("#pdf-preview-panel"), pdfPreviewSelect = $<HTMLSelectElement>("#pdf-preview-file"), pdfPreviewFrame = $<HTMLIFrameElement>("#pdf-preview-frame");

let rows: ImportRow[] = [];
const rowSource = new WeakMap<ImportRow, string>(); // which PDF each review row came from
const rowTime = new WeakMap<ImportRow, string>(); // time (HH:MM:SS) printed inside that PDF
const savedDuplicate = new WeakMap<ImportRow, string>(); // review row -> reference of the saved record it matches
const reviewSources = new Set<string>(); // PDFs whose rows are currently in review
const skippedRows = new WeakSet<ImportRow>();
const previewFiles = new Map<string, File>();
const DRAFT_KEY = "dcn.importDraft";
let reviewRowEls: HTMLTableRowElement[] = [];
let afterSave: () => Promise<void> = async () => {};
let previewUrl: string | null = null;
let draftWriteFailed = false;
let serverCheckWarned = false;

function persistDraft() {
  try {
    if (!rows.length) { localStorage.removeItem(DRAFT_KEY); return; }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(rows.map((row) => ({
      row, source: rowSource.get(row) ?? "", time: rowTime.get(row) ?? "", skipped: skippedRows.has(row),
    }))));
  } catch {
    if (!draftWriteFailed) message("This browser could not save the import draft. Keep this tab open until you finish.", "error");
    draftWriteFailed = true;
  }
}
const persistDraftSoon = debounce(persistDraft, 250);

function releasePreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  pdfPreviewFrame.removeAttribute("src");
}

function showPdfPreview() {
  const file = previewFiles.get(pdfPreviewSelect.value);
  releasePreview();
  if (!file) return;
  previewUrl = URL.createObjectURL(file);
  pdfPreviewFrame.src = previewUrl;
}

function renderPdfPreview() {
  const sources = [...new Set(rows.map((row) => rowSource.get(row)).filter((source): source is string => Boolean(source)))];
  const available = sources.filter((source) => previewFiles.has(source));
  pdfPreviewPanel.classList.toggle("hidden", !available.length);
  pdfPreviewSelect.replaceChildren(...available.map((source) => new Option(source, source)));
  if (available.length) showPdfPreview();
  else releasePreview();
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const saved: unknown = JSON.parse(raw);
    if (!Array.isArray(saved)) throw new Error("The stored draft has an invalid format.");
    for (const entry of saved) {
      if (!entry || typeof entry !== "object" || !entry.row || HEADERS.some((header) => typeof entry.row[header] !== "string")) {
        throw new Error("The stored draft has an invalid row.");
      }
      const row = entry.row as ImportRow;
      rows.push(row);
      if (typeof entry.source === "string" && entry.source) rowSource.set(row, entry.source);
      if (typeof entry.time === "string" && entry.time) rowTime.set(row, entry.time);
      if (entry.skipped === true) skippedRows.add(row);
    }
    if (rows.length) {
      review.classList.remove("hidden");
      sortReviewRows(rows, (row) => rowTime.get(row));
      renderRows();
      message(`Restored ${rows.length} reviewed import row${rows.length === 1 ? "" : "s"} from this browser.`, "success");
    }
  } catch (error) {
    localStorage.removeItem(DRAFT_KEY);
    message(`Could not restore the saved import draft: ${error instanceof Error ? error.message : "invalid draft"}`, "error");
  }
}

// ---- Duplicate highlighting: other review rows (instant) and saved records (asked from the database) ----
function duplicateMatch(row: ImportRow, index: number) {
  const saved = savedDuplicate.get(row);
  if (saved !== undefined) return `saved record ${saved || "(no reference)"}`;
  const other = localDuplicateIndex(rows, index);
  return other >= 0 ? `import row ${other + 1}` : "";
}
let duplicateRequest = 0;
const scheduleServerCheck = debounce(async () => {
  if (!rows.length) return;
  const id = ++duplicateRequest, snapshot = [...rows];
  try {
    const found = await checkDuplicates(snapshot.map(toProbe));
    if (id !== duplicateRequest) return;
    snapshot.forEach((row, index) => {
      const reference = found.get(index);
      if (reference === undefined) savedDuplicate.delete(row); else savedDuplicate.set(row, reference);
    });
    refreshReviewDuplicates();
  } catch (error) {
    // Rows in this import are still compared with each other; only the saved-record comparison is unavailable.
    if (!serverCheckWarned) {
      serverCheckWarned = true;
      message("Could not check saved records for duplicates. Re-run supabase/server-side-records.sql in Supabase.", "error");
    }
    console.warn("Saved-record duplicate check unavailable; only rows in this import are compared.", error);
  }
}, 400);

// Light refresh used while typing: updates highlights and the warning without rebuilding the inputs.
function refreshReviewDuplicates() {
  const duplicateRows: ImportRow[] = [];
  rows.forEach((row, index) => {
    const match = duplicateMatch(row, index), tr = reviewRowEls[index];
    if (match) duplicateRows.push(row);
    if (!tr) return;
    tr.classList.toggle("possible-duplicate", Boolean(match));
    tr.title = match ? `Possible duplicate of ${match}: same quantity and pallet number.` : "";
  });
  const count = duplicateRows.length, plural = count === 1 ? "" : "s";
  reviewDuplicateWarning.classList.toggle("hidden", count === 0);
  reviewDuplicateWarning.textContent = count ? `Possible duplicate${plural} found: ${count} highlighted row${plural} have the same quantity and at least one pallet number as another row or saved record. Transaction Reference${plural}: ${transactionReferences(duplicateRows.map((row) => row["Transaction Reference"]))}. Check before saving.` : "";
}

// Full render: only when rows are added or removed.
function renderRows() {
  reviewHead.innerHTML = `<tr>${HEADERS.map((header) => `<th>${header}</th>`).join("")}<th>Source file</th><th>Skip</th><th></th></tr>`;
  reviewBody.innerHTML = "";
  reviewRowEls = rows.map((row, index) => {
    if (!clean(row.Description)) row.Description = descriptionForItemCode(row["Item Code"]) || row.Description;
    const tr = document.createElement("tr");
    tr.classList.toggle("skipped-row", skippedRows.has(row));
    HEADERS.forEach((header) => {
      const td = document.createElement("td"), input = document.createElement("input");
      input.value = row[header]; input.dataset.field = header; input.setAttribute("aria-label", `${header}, row ${index + 1}`);
      input.addEventListener("input", () => {
        row[header] = input.value;
        if (header === "Item Code") {
          const description = descriptionForItemCode(input.value);
          if (description) {
            row.Description = description;
            const descriptionInput = tr.querySelector<HTMLInputElement>('[data-field="Description"]');
            if (descriptionInput) descriptionInput.value = description;
          }
        }
        updateRowValidation(tr, row);
        refreshReviewDuplicates(); scheduleServerCheck(); persistDraftSoon();
      });
      td.append(input); tr.append(td);
    });
    const time = rowTime.get(row), source = `${rowSource.get(row) ?? "Added manually"}${time ? ` · ${time.slice(0, 5)}` : ""}`, sourceCell = document.createElement("td");
    sourceCell.className = "source-cell"; sourceCell.textContent = source; sourceCell.title = source; tr.append(sourceCell);
    const td = document.createElement("td"), remove = document.createElement("button");
    remove.type = "button"; remove.className = "remove-row"; remove.textContent = "Remove";
    remove.addEventListener("click", () => { rows.splice(index, 1); renderRows(); persistDraft(); });
    const skipCell = document.createElement("td"), skip = document.createElement("input");
    skip.type = "checkbox"; skip.checked = skippedRows.has(row); skip.setAttribute("aria-label", `Skip row ${index + 1}`);
    skip.addEventListener("change", () => {
      if (skip.checked) skippedRows.add(row); else skippedRows.delete(row);
      tr.classList.toggle("skipped-row", skip.checked);
      refreshReviewDuplicates(); persistDraft();
    });
    skipCell.append(skip);
    td.append(remove); tr.append(skipCell, td); reviewBody.append(tr);
    updateRowValidation(tr, row);
    return tr;
  });
  refreshReviewDuplicates();
  scheduleServerCheck();
  renderPdfPreview();
  persistDraftSoon();
}

function updateRowValidation(tr: HTMLTableRowElement, row: ImportRow) {
  const invalid = invalidImportFields(row);
  HEADERS.forEach((header) => {
    const input = tr.querySelector<HTMLInputElement>(`[data-field="${header}"]`);
    if (!input) return;
    const reason = invalid[header];
    const unknownItem = header === "Item Code" && Boolean(clean(row[header])) && !descriptionForItemCode(row[header]);
    input.setAttribute("aria-invalid", String(Boolean(reason)));
    input.classList.toggle("field-invalid", Boolean(reason));
    input.classList.toggle("unknown-item-code", unknownItem);
    input.title = reason ?? (unknownItem ? "Unknown item code; verify the code and description." : "");
  });
}

// ---- Save ----
async function saveRows() {
  if (!rows.length) return;
  const includedRows = rows.filter((row) => !skippedRows.has(row));
  if (!includedRows.length) { message("Every row is marked to skip. Include at least one row to save.", "error"); return; }
  const invalidIndex = includedRows.findIndex((row) => Object.keys(invalidImportFields(row)).length > 0);
  if (invalidIndex >= 0) {
    reviewRowEls.forEach((tr, index) => updateRowValidation(tr, rows[index]));
    review.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
    message("Correct the fields marked in red, or skip rows you do not want to save.", "error");
    return;
  }
  const data: NewTransfer[] = includedRows.map((row) => {
    const quantity = row.Quantity.replace(/,/g, "").trim();
    return {
      transaction_reference: clean(row["Transaction Reference"]), document_date: normalizedDate(clean(row["Document Date"]), false), document_time: rowTime.get(row) ?? null,
      transferred_from: clean(row["Transferred From"]), transferred_to: clean(row["Transferred To"]), item_code: clean(row["Item Code"]), description: clean(row.Description),
      product_code: clean(row["Product Code"]) || null, batch_code: clean(row["Batch Code"]) || null, quantity: quantity === "" ? NaN : Number(quantity),
      pallets: clean(row.Pallets).split(",").map((value) => value.trim()).filter(Boolean), source_filename: rowSource.get(row) ?? "manual entry",
    };
  });
  save.disabled = true;
  message("Saving records to the shared dashboard…", "", 0);
  let saveError: string | undefined;
  try { await insertTransfers(data); } catch (error) { saveError = error instanceof Error ? error.message : "Unexpected error."; } finally { save.disabled = false; }
  if (saveError) { message(`Could not save records: ${saveError}`, "error"); return; }
  const skippedCount = rows.length - includedRows.length;
  rows = []; reviewSources.clear(); previewFiles.clear(); releasePreview(); review.classList.add("hidden"); renderQueue(); persistDraft();
  message(`${data.length} record${data.length === 1 ? "" : "s"} saved${skippedCount ? `; ${skippedCount} skipped` : ""}.`, "success");
  await afterSave();
  location.hash = "#/records";
}

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

async function extractAll() {
  if (extracting) return;
  const batch = queue.filter((item) => item.state !== "reading");
  if (!batch.length) return;
  extracting = true;
  let added = 0, done = 0, failed = 0, split = 0, lastError = "";
  for (const [position, item] of batch.entries()) {
    item.state = "reading"; item.error = undefined; renderQueue();
    message(`Reading PDF ${position + 1} of ${batch.length}: ${item.file.name}…`, "", 0);
    try {
      const { pdfText } = await import("../pdfText"); // pdf.js is only downloaded when the first PDF is read
      const text = await pdfText(item.file);
      const parsed = parse(text, item.file.name), time = pdfTime(text);
      previewFiles.set(item.file.name, item.file);
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
  if (added) { sortReviewRows(rows, (row) => rowTime.get(row)); renderRows(); review.classList.remove("hidden"); } // oldest first, by the time printed in each PDF
  if (!added) { message(failed === 1 ? lastError : `None of the ${failed} PDFs could be processed.`, "error"); return; }
  const parts = [`${added} record${added === 1 ? "" : "s"} added from ${done} PDF${done === 1 ? "" : "s"}.`];
  if (split) parts.push(`${split} file${split === 1 ? "" : "s"} had several batch entries in the filename; check the split records.`);
  if (failed) parts.push(`${failed} PDF${failed === 1 ? "" : "s"} failed and ${failed === 1 ? "is" : "are"} still listed above.`);
  parts.push("Review the records before saving.");
  message(parts.join(" "), failed ? "error" : "success");
  review.scrollIntoView({ block: "start" });
}

export function initImport(onSaved: () => Promise<void>) {
  afterSave = onSaved;
  pdfPreviewSelect.addEventListener("change", showPdfPreview);
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

  extract.addEventListener("click", () => void extractAll());
  addRow.addEventListener("click", () => { rows.push(Object.fromEntries(HEADERS.map((header) => [header, ""])) as ImportRow); renderRows(); persistDraft(); });
  save.addEventListener("click", () => void saveRows());
  reset.addEventListener("click", () => { rows = []; reviewSources.clear(); previewFiles.clear(); releasePreview(); review.classList.add("hidden"); persistDraft(); message("Import discarded."); });
  renderQueue();
  restoreDraft();
}
