import { $ } from "../dom";
import { HEADERS, itemFilterName } from "../constants";
import type { RecordFilters, RecordsPage, SortMode } from "../types";
import { debounce, displayDate, normalizedDate, transactionReferences } from "../utils";
import { groupTransfers, palletLines } from "../grouping";
import { fetchAllRecords, fetchRecords } from "../api";
import { buildItemPicker, fillItems } from "./itemPicker";
import { openDrawer } from "./drawer";
import { exportToExcel, type ExportContext } from "./exportExcel";
import { message } from "./toast";

const search = $<HTMLInputElement>("#search-input"), dateFrom = $<HTMLInputElement>("#date-from-filter"), dateTo = $<HTMLInputElement>("#date-to-filter"), batchFilter = $<HTMLInputElement>("#batch-filter"), itemFilter = $<HTMLSelectElement>("#item-filter"), sortFilter = $<HTMLSelectElement>("#sort-filter");
const clearFilters = $<HTMLButtonElement>("#clear-filters-button"), refresh = $<HTMLButtonElement>("#refresh-button"), exportButton = $<HTMLButtonElement>("#export-button");
const recordsTable = $<HTMLTableElement>("#records-table"), recordsHead = $<HTMLTableSectionElement>("#records-table thead"), recordsBody = $<HTMLTableSectionElement>("#records-table tbody");
const recordsDescription = $<HTMLElement>("#records-description"), recordsTotalQuantity = $<HTMLElement>("#records-total-quantity"), recordsQuantityNote = $<HTMLElement>("#records-quantity-note"), recordsDuplicateWarning = $<HTMLParagraphElement>("#records-duplicate-warning");
const pageInfo = $<HTMLElement>("#page-info"), pageSizeSelect = $<HTMLSelectElement>("#page-size"), pagePrev = $<HTMLButtonElement>("#page-prev"), pageNext = $<HTMLButtonElement>("#page-next"), pagination = $<HTMLElement>("#records-pagination");

const HIDDEN_KEY = "dcn.hiddenColumns";
const LOCKED = new Set<number>([0]); // the reference column cannot be hidden
let page = 0, pageSize = Number(pageSizeSelect.value) || 50, requestId = 0;
let result: RecordsPage = { rows: [], totalGroups: 0, totalRecords: 0, totalQuantity: 0 };
let hidden = loadHidden();
let syncItemPicker: () => void = () => {};

function loadHidden() {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
    return new Set(Array.isArray(list) ? list.filter((n): n is number => Number.isInteger(n) && n > 0 && n < HEADERS.length) : []);
  } catch { return new Set<number>(); }
}
function saveHidden() { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden])); } catch { /* storage unavailable */ } }

function filters(): RecordFilters {
  return { query: search.value, dateFrom: dateFrom.value, dateTo: dateTo.value, batch: batchFilter.value, item: itemFilter.value, sort: sortFilter.value as SortMode };
}
const isFiltered = (f: RecordFilters) => Boolean(f.query.trim() || f.dateFrom || f.dateTo || f.batch.trim() || f.item);

/** Text and values describing the current filters, used by the Excel export. */
export function describeFilters(): ExportContext {
  const f = filters(), from = normalizedDate(f.dateFrom), to = normalizedDate(f.dateTo);
  const parts = [
    f.query.trim() ? `Search contains "${f.query.trim()}"` : "",
    from ? `Date from ${displayDate(from)}` : "",
    to ? `Date to ${displayDate(to)}` : "",
    f.item ? `Item ${itemFilterName(f.item)}` : "",
    f.batch.trim() ? `Batch code contains "${f.batch.trim()}"` : "",
  ].filter(Boolean);
  return { text: parts.length ? parts.join("; ") : "none (all records)", from, to, batch: f.batch.trim() };
}

export async function loadRecords() {
  const id = ++requestId;
  recordsDescription.textContent = "Loading records…";
  try {
    let next = await fetchRecords(filters(), page, pageSize);
    if (id !== requestId) return;
    const lastPage = Math.max(0, Math.ceil(next.totalGroups / pageSize) - 1);
    if (page > lastPage) { // e.g. records were deleted while on a late page
      page = lastPage;
      next = await fetchRecords(filters(), page, pageSize);
      if (id !== requestId) return;
    }
    result = next;
    render();
  } catch (error) {
    if (id !== requestId) return;
    recordsDescription.textContent = "Could not load records.";
    message(`Could not load records: ${error instanceof Error ? error.message : "unexpected error"}`, "error");
  }
}

function render() {
  syncItemPicker();
  const f = filters(), plural = (n: number) => (n === 1 ? "" : "s");
  recordsDescription.textContent = `${result.totalRecords.toLocaleString()} record${plural(result.totalRecords)} in ${result.totalGroups.toLocaleString()} transaction${plural(result.totalGroups)}`;
  recordsTotalQuantity.textContent = result.totalQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 });
  recordsQuantityNote.textContent = isFiltered(f) ? `${result.totalRecords.toLocaleString()} record${plural(result.totalRecords)} match the current search and filters` : `All ${result.totalRecords.toLocaleString()} record${plural(result.totalRecords)}`;

  const duplicateRows = result.rows.filter((transfer) => transfer.is_duplicate);
  recordsDuplicateWarning.classList.toggle("hidden", duplicateRows.length === 0);
  recordsDuplicateWarning.textContent = duplicateRows.length
    ? `Possible duplicate${plural(duplicateRows.length)} found: ${duplicateRows.length} highlighted batch line${plural(duplicateRows.length)} on this page share the same batch code, quantity and at least one pallet with another saved record. Transaction Reference${plural(duplicateRows.length)}: ${transactionReferences(duplicateRows.map((transfer) => transfer.transaction_reference))}.`
    : "";

  recordsTable.style.minWidth = hidden.size ? "0" : "";
  recordsHead.innerHTML = `<tr>${HEADERS.map((header, index) => `<th${hidden.has(index) ? ' class="col-hidden"' : ""}>${header}</th>`).join("")}</tr>`;
  recordsBody.innerHTML = "";

  for (const members of groupTransfers(result.rows)) {
    const [first] = members, tr = document.createElement("tr");
    const duplicateIds = new Set(members.filter((transfer) => transfer.is_duplicate).map((transfer) => transfer.id));
    tr.className = duplicateIds.size ? "clickable has-duplicate" : "clickable";
    tr.tabIndex = 0; tr.title = "Click for details";
    tr.addEventListener("click", () => { if (!window.getSelection()?.toString()) openDrawer(members, tr); });
    tr.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDrawer(members, tr); } });

    const stackCell = (body: HTMLElement, pick: (transfer: (typeof members)[number]) => string) => {
      members.forEach((transfer) => {
        const line = document.createElement("span");
        line.className = duplicateIds.has(transfer.id) ? "stack-line dup-line" : "stack-line";
        if (duplicateIds.has(transfer.id)) line.title = "Possible duplicate: another saved record has the same batch code, quantity and pallet.";
        line.textContent = pick(transfer) || (members.length > 1 ? "—" : "");
        body.append(line);
      });
    };
    const values = [first.transaction_reference, displayDate(first.document_date, true), first.transferred_from, first.transferred_to, first.item_code, first.description, first.product_code ?? "", "", "", palletLines([...new Set(members.flatMap((transfer) => transfer.pallets))])];
    values.forEach((value, index) => {
      const td = document.createElement("td"), body = document.createElement("div");
      td.dataset.label = HEADERS[index]; body.className = "cell-body";
      if (hidden.has(index)) td.classList.add("col-hidden");
      if (index === 7) { td.classList.add("stacked"); stackCell(body, (transfer) => transfer.batch_code ?? ""); }
      else if (index === 8) { td.classList.add("stacked"); stackCell(body, (transfer) => String(transfer.quantity)); }
      else {
        body.textContent = value;
        if (index === 9) td.classList.add("stacked");
        if (index === 0 && duplicateIds.size) { const badge = document.createElement("span"); badge.className = "dup-badge"; badge.textContent = "Possible duplicate"; badge.title = "A batch in this transaction matches another saved record (same batch code, quantity and pallet)."; body.append(badge); }
      }
      td.append(body); tr.append(td);
    });
    recordsBody.append(tr);
  }
  if (!result.rows.length) {
    const tr = document.createElement("tr"), td = document.createElement("td");
    td.colSpan = HEADERS.length; td.className = "empty";
    td.textContent = isFiltered(f) ? "No records match your search." : "No transfers yet. Import an IWTS PDF to add your first records.";
    tr.append(td); recordsBody.append(tr);
  }

  const start = result.totalGroups ? page * pageSize + 1 : 0, end = Math.min((page + 1) * pageSize, result.totalGroups);
  pageInfo.textContent = result.totalGroups ? `Transactions ${start.toLocaleString()}–${end.toLocaleString()} of ${result.totalGroups.toLocaleString()}` : "No transactions";
  pagePrev.disabled = page === 0; pageNext.disabled = end >= result.totalGroups;
  pagination.classList.toggle("hidden", result.totalGroups === 0);

  exportButton.disabled = !result.totalRecords;
  exportButton.title = result.totalRecords ? `Download all ${result.totalRecords.toLocaleString()} record${plural(result.totalRecords)} matching the current search and filters as an Excel workbook` : "No records to download";
}

function buildColumnPicker() {
  const host = $<HTMLElement>("#columns-picker");
  const button = document.createElement("button"), menu = document.createElement("div"), boxes: HTMLInputElement[] = [];
  button.type = "button"; button.className = "secondary"; button.textContent = "Columns"; button.setAttribute("aria-haspopup", "true"); button.setAttribute("aria-expanded", "false");
  menu.className = "columns-menu hidden"; menu.setAttribute("role", "group"); menu.setAttribute("aria-label", "Visible columns");
  HEADERS.forEach((header, index) => {
    if (LOCKED.has(index)) return;
    const label = document.createElement("label"), box = document.createElement("input");
    box.type = "checkbox"; box.checked = !hidden.has(index);
    box.addEventListener("change", () => { if (box.checked) hidden.delete(index); else hidden.add(index); saveHidden(); render(); });
    boxes.push(box);
    label.append(box, document.createTextNode(header)); menu.append(label);
  });
  const showAll = document.createElement("button");
  showAll.type = "button"; showAll.className = "text-button"; showAll.textContent = "Show all columns";
  showAll.addEventListener("click", () => { hidden = new Set(); saveHidden(); boxes.forEach((box) => { box.checked = true; }); render(); });
  menu.append(showAll);
  const setOpen = (open: boolean) => { menu.classList.toggle("hidden", !open); button.setAttribute("aria-expanded", String(open)); };
  button.addEventListener("click", () => setOpen(menu.classList.contains("hidden")));
  document.addEventListener("click", (event) => { if (!host.contains(event.target as Node)) setOpen(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !menu.classList.contains("hidden")) { setOpen(false); button.focus(); } });
  host.append(button, menu);
}

export function initRecords() {
  fillItems(itemFilter);
  syncItemPicker = buildItemPicker(itemFilter);
  buildColumnPicker();

  const reloadFromStart = () => { page = 0; void loadRecords(); };
  const reloadSoon = debounce(reloadFromStart, 300);
  search.addEventListener("input", reloadSoon);
  batchFilter.addEventListener("input", reloadSoon);
  for (const control of [dateFrom, dateTo, itemFilter, sortFilter]) control.addEventListener("change", reloadFromStart);
  clearFilters.addEventListener("click", () => {
    dateFrom.value = ""; dateTo.value = ""; batchFilter.value = ""; itemFilter.value = ""; sortFilter.value = "date-desc"; search.value = "";
    syncItemPicker(); reloadFromStart();
  });
  refresh.addEventListener("click", () => void loadRecords());

  pagePrev.addEventListener("click", () => { if (page > 0) { page--; void loadRecords(); recordsTable.scrollIntoView({ block: "start" }); } });
  pageNext.addEventListener("click", () => { page++; void loadRecords(); recordsTable.scrollIntoView({ block: "start" }); });
  pageSizeSelect.addEventListener("change", () => { pageSize = Number(pageSizeSelect.value) || 50; reloadFromStart(); });

  exportButton.addEventListener("click", async () => {
    if (!result.totalRecords) return;
    exportButton.disabled = true;
    message("Collecting records…", "", 0);
    try {
      const list = await fetchAllRecords(filters(), (done, total) => message(`Collecting records… ${done.toLocaleString()} of ${total.toLocaleString()} transactions`, "", 0));
      await exportToExcel(list, describeFilters());
    } catch (error) {
      message(`Could not export: ${error instanceof Error ? error.message : "unexpected error"}`, "error");
    } finally {
      exportButton.disabled = !result.totalRecords;
    }
  });
}
