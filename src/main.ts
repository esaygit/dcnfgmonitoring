// xlsx-js-style preserves existing cell fills, fonts, borders, and number formats
// when the selected workbook is written back to disk.
import * as XLSX from "xlsx-js-style";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./style.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const HEADERS = [
  "Transaction Reference", "Document Date", "Transferred From", "Transferred To",
  "Item Code", "Description", "Product Code", "Batch Code", "Quantity", "Pallets",
] as const;

type Header = (typeof HEADERS)[number];
type RecordRow = Record<Header, string>;

const pdfInput = document.querySelector<HTMLInputElement>("#pdf-file")!;
const openWorkbookButton = document.querySelector<HTMLButtonElement>("#open-workbook-button")!;
const extractButton = document.querySelector<HTMLButtonElement>("#extract-button")!;
const saveButton = document.querySelector<HTMLButtonElement>("#save-button")!;
const addRowButton = document.querySelector<HTMLButtonElement>("#add-row-button")!;
const resetButton = document.querySelector<HTMLButtonElement>("#reset-button")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const reviewSection = document.querySelector<HTMLElement>("#review-section")!;
const tableHead = document.querySelector<HTMLTableSectionElement>("#review-table thead")!;
const tableBody = document.querySelector<HTMLTableSectionElement>("#review-table tbody")!;
const pdfName = document.querySelector<HTMLElement>("#pdf-name")!;
const workbookName = document.querySelector<HTMLElement>("#workbook-name")!;

let rows: RecordRow[] = [];
let sourceWorkbook: XLSX.WorkBook | null = null;
let workbookHandle: FileSystemFileHandle | null = null;
let saved = false;

function setStatus(message: string, kind: "" | "error" | "success" = "") {
  status.textContent = message;
  status.className = `status ${kind}`;
}

function fileChanged() {
  pdfName.textContent = pdfInput.files?.[0]?.name ?? "No PDF selected";
  extractButton.disabled = !(pdfInput.files?.[0] && sourceWorkbook && workbookHandle);
  if (!extractButton.disabled) setStatus("Ready to extract. Your files will remain in this browser.");
}

function clean(value: string | undefined) { return (value ?? "").replace(/\s+/g, " ").trim(); }
function match(text: string, pattern: RegExp) { return clean(text.match(pattern)?.[1]); }
async function getPdfText(file: File) {
  const document = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
  }
  return pages.join("\n");
}

function palletsFromFilename(filename: string) {
  const base = filename.replace(/\.pdf$/i, "");
  const palletPart = base.match(/\bPALLETS?\s+(.+?)(?=\s+\d{8}\b|$)/i)?.[1] ?? "";
  return (palletPart.match(/\b\d{3,6}\b/g) ?? []).join(", ");
}

function parsePdf(text: string, filename: string): RecordRow[] {
  const transactionReference = match(text, /\b(GAA\s*\d{4,})\b/i).replace(/\s+/g, "");
  const documentDate = match(text, /DOCUMENT\s+DATE\s*:\s*(\d{2}-\d{2}-\d{2})/i);
  const transferredFrom = match(text, /SHIP\s+FROM\s*:\s*(W\d+)/i);
  const transferredTo = match(text, /SHIP\s+TO\s*:\s*(W\d+)/i);
  const palletNumbers = palletsFromFilename(filename);
  const lineItems = [...text.matchAll(/(?:^|\s)(\d{8,})\s*(.*?)\s+([A-Z0-9-]+)LOC\s+([A-Z0-9-]+)\s+([\d,]+(?:\.\d+)?)(?=\s+)/gi)];

  if (lineItems.length === 0) {
    return [{
      "Transaction Reference": transactionReference,
      "Document Date": documentDate,
      "Transferred From": transferredFrom,
      "Transferred To": transferredTo,
      "Item Code": "",
      "Description": "",
      "Product Code": "",
      "Batch Code": "",
      "Quantity": "",
      "Pallets": palletNumbers,
    }];
  }

  return lineItems.map((item) => ({
    "Transaction Reference": transactionReference,
    "Document Date": documentDate,
    "Transferred From": transferredFrom,
    "Transferred To": transferredTo,
    "Item Code": clean(item[1]),
    "Description": clean(item[2]),
    "Product Code": clean(item[3]),
    "Batch Code": clean(item[4]),
    "Quantity": clean(item[5]),
    "Pallets": palletNumbers,
  }));
}

function renderRows() {
  tableHead.innerHTML = `<tr>${HEADERS.map((header) => `<th>${header}</th>`).join("")}<th aria-label="Remove row"></th></tr>`;
  tableBody.innerHTML = "";
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    for (const header of HEADERS) {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.value = row[header];
      input.setAttribute("aria-label", `${header}, row ${rowIndex + 1}`);
      input.addEventListener("input", () => { rows[rowIndex][header] = input.value; });
      td.append(input);
      tr.append(td);
    }
    const action = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "remove-row"; remove.textContent = "Remove";
    remove.addEventListener("click", () => { rows.splice(rowIndex, 1); renderRows(); });
    action.append(remove); tr.append(action); tableBody.append(tr);
  });
}

function ensureHeaders(sheet: XLSX.WorkSheet) {
  const firstRow = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false })[0] ?? [];
  const actual = firstRow.map((value) => clean(String(value)));
  const missing = HEADERS.filter((header) => !actual.includes(header));
  if (missing.length) throw new Error(`The selected workbook is missing these headers: ${missing.join(", ")}.`);
}

function appendRowsToSheet(sheet: XLSX.WorkSheet, newRows: RecordRow[]) {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const headerColumns = new Map<string, number>();
  for (let column = range.s.c; column <= range.e.c; column++) {
    const header = clean(String(sheet[XLSX.utils.encode_cell({ r: 0, c: column })]?.v ?? ""));
    if (header) headerColumns.set(header, column);
  }
  let lastDataRow = 0;
  for (let row = 1; row <= range.e.r; row++) {
    if ([...headerColumns.values()].some((column) => sheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v !== undefined)) lastDataRow = row;
  }
  newRows.forEach((record, offset) => {
    const row = lastDataRow + 1 + offset;
    for (const header of HEADERS) {
      const column = headerColumns.get(header);
      if (column === undefined) continue;
      sheet[XLSX.utils.encode_cell({ r: row, c: column })] = { t: "s", v: record[header] };
      range.e.r = Math.max(range.e.r, row);
    }
  });
  sheet["!ref"] = XLSX.utils.encode_range(range);
}

extractButton.addEventListener("click", async () => {
  const pdf = pdfInput.files?.[0];
  if (!pdf || !sourceWorkbook) return;
  try {
    extractButton.disabled = true; setStatus("Reading your PDF…");
    rows = parsePdf(await getPdfText(pdf), pdf.name);
    saved = false; saveButton.disabled = false;
    renderRows(); reviewSection.classList.remove("hidden");
    setStatus("Extraction complete. Review the values below, then download the updated workbook.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not process the files.", "error");
  } finally { extractButton.disabled = false; }
});

openWorkbookButton.addEventListener("click", async () => {
  if (!window.showOpenFilePicker) {
    setStatus("Direct workbook editing requires Microsoft Edge or Google Chrome.", "error");
    return;
  }
  try {
    setStatus("Choose the local dcnfgmonitoring.xlsx workbook…");
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: "Excel workbook",
        accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
      }],
    });
    const file = await handle.getFile();
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) throw new Error("The selected workbook has no worksheets.");
    ensureHeaders(firstSheet);
    workbookHandle = handle;
    sourceWorkbook = workbook;
    workbookName.textContent = file.name;
    fileChanged();
    if (!pdfInput.files?.[0]) setStatus("Workbook opened. Select an IWTS PDF to continue.", "success");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") { setStatus("Workbook selection cancelled."); return; }
    setStatus(error instanceof Error ? error.message : "Could not open the workbook.", "error");
  }
});

addRowButton.addEventListener("click", () => { rows.push(Object.fromEntries(HEADERS.map((header) => [header, ""])) as RecordRow); renderRows(); });

saveButton.addEventListener("click", async () => {
  if (!sourceWorkbook || !workbookHandle || rows.length === 0 || saved) return;
  try {
    saveButton.disabled = true;
    setStatus("Saving changes to the selected workbook…");
    const sheet = sourceWorkbook.Sheets[sourceWorkbook.SheetNames[0]];
    appendRowsToSheet(sheet, rows);
    const writable = await workbookHandle.createWritable();
    await writable.write(XLSX.write(sourceWorkbook, { bookType: "xlsx", type: "array", compression: true }));
    await writable.close();
    saved = true;
    setStatus("Saved directly to the selected workbook.", "success");
  } catch (error) {
    saveButton.disabled = false;
    setStatus("Could not save. Close the workbook in Excel and try again. " + (error instanceof Error ? error.message : ""), "error");
  }
});

resetButton.addEventListener("click", () => { pdfInput.value = ""; rows = []; sourceWorkbook = null; workbookHandle = null; saved = false; workbookName.textContent = "No workbook opened"; reviewSection.classList.add("hidden"); fileChanged(); setStatus("Select a PDF and open the workbook to begin."); });
pdfInput.addEventListener("change", fileChanged);
