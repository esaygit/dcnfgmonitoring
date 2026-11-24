import { $ } from "../dom";
import { fetchRejectionHistory, fetchRejectionOptions, submitLoadingRejection } from "../api";
import type { RejectionHistory, RejectionOption } from "../types";
import { displayDate, fmt, normalizedDate } from "../utils";
import { message } from "./toast";
import { remainingRejectedQuantity, validateRejectedQuantity } from "../rejectionModel";

const reference = $<HTMLInputElement>("#reject-reference");
const rejectionDate = $<HTMLInputElement>("#reject-date");
const linesHost = $<HTMLElement>("#reject-lines");
const datalist = $<HTMLDataListElement>("#reject-batch-options");
const errors = $<HTMLElement>("#reject-errors");
const preview = $<HTMLElement>("#reject-preview");
const confirmActions = $<HTMLElement>("#reject-confirm-actions");
const confirmButton = $<HTMLButtonElement>("#reject-confirm");
const historyReference = $<HTMLInputElement>("#reject-history-reference");
const historyBatch = $<HTMLInputElement>("#reject-history-batch");
const historyFrom = $<HTMLInputElement>("#reject-history-from");
const historyTo = $<HTMLInputElement>("#reject-history-to");
const historyBody = $<HTMLElement>("#reject-history-body");

let options: RejectionOption[] = [];
let reviewedLines: unknown[] | null = null;

function todayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function candidatesForBatch(batch: string) {
  return options.filter((option) => option.batch_code.trim().toLowerCase() === batch.trim().toLowerCase());
}

function selectedOption(line: HTMLElement) {
  const batch = line.querySelector<HTMLInputElement>('[data-field="batch"]')?.value.trim() ?? "";
  const warehouse = line.querySelector<HTMLSelectElement>('[data-field="warehouse"]')?.value ?? "";
  return candidatesForBatch(batch).find((option) =>
    option.warehouse_code.toLowerCase() === warehouse.toLowerCase() ||
    !warehouse
  );
}

function refreshLineSelection(line: HTMLElement) {
  const batchInput = line.querySelector<HTMLInputElement>('[data-field="batch"]')!;
  const warehouse = line.querySelector<HTMLSelectElement>('[data-field="warehouse"]')!;
  const item = line.querySelector<HTMLInputElement>('[data-field="item"]')!;
  const original = line.querySelector<HTMLInputElement>('[data-field="original"]')!;
  const available = line.querySelector<HTMLInputElement>('[data-field="available"]')!;
  const candidates = candidatesForBatch(batchInput.value);
  const previous = warehouse.value;
  warehouse.replaceChildren(...[...new Set(candidates.map((candidate) => candidate.warehouse_code))]
    .map((code) => { const option = document.createElement("option"); option.value = code; option.textContent = code; return option; }));
  if ([...warehouse.options].some((option) => option.value === previous)) warehouse.value = previous;
  const chosen = selectedOption(line);
  item.value = chosen?.item_code ?? "";
  original.value = chosen ? fmt(chosen.original_quantity) : "";
  available.value = chosen ? fmt(chosen.available_quantity) : "";
  line.dataset.itemCode = chosen?.item_code ?? "";
  line.dataset.available = chosen ? String(chosen.available_quantity) : "";
  updateRemaining(line);
}

function updateRemaining(line: HTMLElement) {
  const remaining = line.querySelector<HTMLInputElement>('[data-field="remaining"]')!;
  const quantity = line.querySelector<HTMLInputElement>('[data-field="quantity"]')!;
  const available = Number(line.dataset.available ?? 0);
  const rejected = Number(quantity.value);
  const nextRemaining = remainingRejectedQuantity(rejected, available);
  remaining.value = quantity.value && nextRemaining !== null ? fmt(nextRemaining) : "";
}

function addLine(option?: RejectionOption) {
  const line = document.createElement("fieldset");
  line.className = "reject-line";
  line.innerHTML = `
    <legend>Batch line</legend>
    <button type="button" class="secondary reject-remove" aria-label="Remove batch line">Remove</button>
    <div class="reject-line-grid">
      <label class="field">Batch code<input data-field="batch" type="search" list="reject-batch-options" autocomplete="off" required /></label>
      <label class="field">Warehouse<select data-field="warehouse" required></select></label>
      <label class="field">Item code<input data-field="item" type="text" readonly /></label>
      <label class="field">Original quantity<input data-field="original" type="text" readonly /></label>
      <label class="field">Rejected quantity<input data-field="quantity" type="number" min="0.0001" step="0.0001" required /></label>
      <label class="field">Remaining quantity<input data-field="remaining" type="text" readonly /></label>
      <label class="field reject-remarks">Remarks<textarea data-field="remarks" rows="2" required></textarea></label>
    </div>`;
  linesHost.append(line);

  line.querySelector<HTMLInputElement>('[data-field="batch"]')!.addEventListener("input", () => refreshLineSelection(line));
  line.querySelector<HTMLSelectElement>('[data-field="warehouse"]')!.addEventListener("change", () => refreshLineSelection(line));
  line.querySelector<HTMLInputElement>('[data-field="quantity"]')!.addEventListener("input", () => updateRemaining(line));
  line.querySelector<HTMLButtonElement>(".reject-remove")!.addEventListener("click", () => {
    line.remove();
    hideReview();
  });

  if (option) {
    line.querySelector<HTMLInputElement>('[data-field="batch"]')!.value = option.batch_code;
    refreshLineSelection(line);
  }
  hideReview();
  return line;
}

function hideReview() {
  reviewedLines = null;
  preview.classList.add("hidden");
  preview.replaceChildren();
  confirmActions.classList.add("hidden");
  errors.classList.add("hidden");
  errors.textContent = "";
}

function validateLines() {
  const lineElements = [...linesHost.querySelectorAll<HTMLElement>(".reject-line")];
  if (!lineElements.length) return { errors: ["Add at least one batch line."], lines: [] as unknown[] };
  const found: string[] = [], lines: unknown[] = [];
  const keys = new Set<string>();

  for (const line of lineElements) {
    const batch = line.querySelector<HTMLInputElement>('[data-field="batch"]')!.value.trim();
    const warehouse = line.querySelector<HTMLSelectElement>('[data-field="warehouse"]')!.value.trim();
    const item = line.dataset.itemCode?.trim() ?? "";
    const quantityText = line.querySelector<HTMLInputElement>('[data-field="quantity"]')!.value;
    const remarks = line.querySelector<HTMLTextAreaElement>('[data-field="remarks"]')!.value.trim();
    const quantity = Number(quantityText);
    const available = Number(line.dataset.available ?? 0);
    if (!batch) found.push("A batch code is required for every line.");
    if (!warehouse) found.push(`Select a warehouse for batch ${batch || "—"}.`);
    if (!item) found.push(`Batch ${batch || "—"} was not found at the selected warehouse.`);
    const quantityError = validateRejectedQuantity(quantityText, available);
    if (quantityError) found.push(`Batch ${batch || "—"}: ${quantityError}`);
    if (!remarks) found.push(`Remarks are required for batch ${batch || "—"}.`);
    if (batch && item && warehouse) {
      const key = `${batch.toLowerCase()}|${item.toLowerCase()}|${warehouse.toLowerCase()}`;
      if (keys.has(key)) found.push(`Batch ${batch} is duplicated for the same item and warehouse; consolidate it into one line.`);
      keys.add(key);
    }
    if (batch && item && warehouse && Number.isFinite(quantity) && quantity > 0 && remarks) {
      lines.push({ batch_code: batch, item_code: item, warehouse_code: warehouse, rejected_quantity: quantity, remarks });
    }
  }
  return { errors: [...new Set(found)], lines };
}

function showReview() {
  const result = validateLines();
  if (result.errors.length) {
    errors.textContent = result.errors.join(" ");
    errors.classList.remove("hidden");
    preview.classList.add("hidden");
    confirmActions.classList.add("hidden");
    reviewedLines = null;
    return;
  }
  reviewedLines = result.lines;
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>Batch code</th><th>Item code</th><th>Warehouse</th><th class=\"num\">Rejected</th><th>Remarks</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const line of result.lines as { batch_code: string; item_code: string; warehouse_code: string; rejected_quantity: number; remarks: string }[]) {
    const tr = document.createElement("tr");
    [line.batch_code, line.item_code, line.warehouse_code, fmt(line.rejected_quantity), line.remarks].forEach((text, index) => {
      const td = document.createElement("td"); td.textContent = text;
      if (index === 3) td.className = "num";
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(tbody);
  preview.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "Review rejection";
  preview.append(heading, table);
  preview.classList.remove("hidden");
  confirmActions.classList.remove("hidden");
  errors.classList.add("hidden");
}

async function loadHistory() {
  historyBody.innerHTML = `<p class="muted">Loading rejection history…</p>`;
  try {
    const rows = await fetchRejectionHistory(
      historyReference.value.trim(),
      historyBatch.value.trim(),
      normalizedDate(historyFrom.value) || null,
      normalizedDate(historyTo.value) || null,
    );
    renderHistory(rows);
  } catch (error) {
    historyBody.textContent = "";
    message(error instanceof Error ? error.message : "Could not load rejection history.", "error");
  }
}

function renderHistory(rows: RejectionHistory[]) {
  if (!rows.length) {
    historyBody.innerHTML = `<p class="reject-empty">No rejection transactions match the current filters.</p>`;
    return;
  }
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>Rejection reference</th><th>Rejection date</th><th class=\"num\">Affected batches</th><th class=\"num\">Total rejected</th><th>Recorded by</th><th>Date created</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    const values = [row.rejection_reference, displayDate(row.rejection_date), String(row.affected_batches), fmt(row.total_rejected_quantity), row.recorded_by, new Date(row.created_at).toLocaleString()];
    values.forEach((text, index) => { const td = document.createElement("td"); td.textContent = text; if (index === 2 || index === 3) td.className = "num"; tr.append(td); });
    const action = document.createElement("td");
    const button = document.createElement("button"); button.type = "button"; button.className = "secondary"; button.textContent = "View";
    button.addEventListener("click", () => showHistoryDetail(row));
    action.append(button); tr.append(action); tbody.append(tr);
  }
  table.append(tbody);
  const detail = document.createElement("div");
  detail.id = "reject-history-detail";
  historyBody.replaceChildren(table, detail);
}

function showHistoryDetail(row: RejectionHistory) {
  const detail = $<HTMLElement>("#reject-history-detail");
  detail.className = "reject-history-detail";
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>Batch code</th><th>Item code</th><th>Warehouse</th><th class=\"num\">Rejected</th><th class=\"num\">Original available</th><th class=\"num\">Remaining</th><th>Remarks</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const item of row.items) {
    const tr = document.createElement("tr");
    [item.batch_code, item.item_code, item.warehouse_code, fmt(item.rejected_quantity), fmt(item.original_available_quantity), fmt(item.remaining_quantity), item.remarks].forEach((text, index) => {
      const td = document.createElement("td"); td.textContent = text;
      if (index >= 3 && index <= 5) td.className = "num";
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(tbody);
  detail.replaceChildren(table);
  detail.scrollIntoView({ block: "nearest" });
}

export function initRejects() {
  rejectionDate.value = todayIso();
  addLine();
  void fetchRejectionOptions().then((next) => {
    options = next;
    datalist.replaceChildren(...[...new Set(next.map((option) => option.batch_code))].map((batch) => {
      const item = document.createElement("option"); item.value = batch; return item;
    }));
  }).catch((error) => message(error instanceof Error ? error.message : "Could not load rejection batches.", "error"));

  $<HTMLButtonElement>("#reject-add-line").addEventListener("click", () => addLine());
  $<HTMLButtonElement>("#reject-review").addEventListener("click", showReview);
  confirmButton.addEventListener("click", async () => {
    if (!reviewedLines) return;
    confirmButton.disabled = true;
    try {
      const result = await submitLoadingRejection(reference.value.trim(), rejectionDate.value, reviewedLines);
      message(`Rejection ${result?.rejection_reference ?? ""} saved successfully.`, "success");
      reference.value = "";
      rejectionDate.value = todayIso();
      linesHost.replaceChildren();
      addLine();
      hideReview();
      await loadHistory();
      void fetchRejectionOptions().then((next) => { options = next; });
    } catch (error) {
      errors.textContent = error instanceof Error ? error.message : "Could not save rejection.";
      errors.classList.remove("hidden");
      confirmActions.classList.remove("hidden");
    } finally {
      confirmButton.disabled = false;
    }
  });

  [historyReference, historyBatch, historyFrom, historyTo].forEach((control) => {
    control.addEventListener(control instanceof HTMLInputElement && control.type === "search" ? "input" : "change", () => void loadHistory());
  });
  void loadHistory();
}
