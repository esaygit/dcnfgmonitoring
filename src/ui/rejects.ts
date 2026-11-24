import { $ } from "../dom";
import { fetchRejectionHistory, fetchRejectionOptions, submitLoadingRejection } from "../api";
import type { RejectionHistory, RejectionOption, RejectionSubmissionLine } from "../types";
import { displayDate, fmt, normalizedDate } from "../utils";
import { message } from "./toast";
import { remainingRejectedQuantity, rejectionLineKey, resolveBatchBalance, validateRejectedQuantity } from "../rejectionModel";

const reference = $<HTMLInputElement>("#reject-reference");
const linesHost = $<HTMLElement>("#reject-lines");
const datalist = $<HTMLDataListElement>("#reject-batch-options");
const errors = $<HTMLElement>("#reject-errors");
const preview = $<HTMLElement>("#reject-preview");
const confirmActions = $<HTMLElement>("#reject-confirm-actions");
const confirmButton = $<HTMLButtonElement>("#reject-confirm");
const historyBatch = $<HTMLInputElement>("#reject-history-batch");
const historyFrom = $<HTMLInputElement>("#reject-history-from");
const historyTo = $<HTMLInputElement>("#reject-history-to");
const historyBody = $<HTMLElement>("#reject-history-body");

let options: RejectionOption[] = [];
let reviewedLines: RejectionSubmissionLine[] | null = null;

function todayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function candidatesForBatch(batch: string) {
  return options.filter((option) => option.batch_code.trim().toLowerCase() === batch.trim().toLowerCase());
}

function lineField<T extends HTMLElement>(line: HTMLElement, name: string) {
  const field = line.querySelector<T>(`[data-field="${name}"]`);
  if (!field) throw new Error(`Rejection line is missing its ${name} field.`);
  return field;
}

function refreshLineSelection(line: HTMLElement) {
  const batchInput = lineField<HTMLInputElement>(line, "batch");
  const original = lineField<HTMLInputElement>(line, "original");
  const quantity = lineField<HTMLInputElement>(line, "quantity");
  const status = lineField<HTMLElement>(line, "balance-status");
  const candidates = candidatesForBatch(batchInput.value);
  const resolution = resolveBatchBalance(candidates);
  const chosen = resolution.kind === "resolved" ? resolution.option : null;
  original.value = chosen ? fmt(chosen.available_quantity) : "";
  line.dataset.available = chosen ? String(chosen.available_quantity) : "";
  if (!batchInput.value.trim()) status.textContent = "";
  else if (resolution.kind === "none") status.textContent = "No positive current balance found for this batch.";
  else if (resolution.kind === "ambiguous") status.textContent = "This batch has multiple current stock balances. Contact an administrator; it cannot be selected automatically.";
  else status.textContent = "";
  status.classList.toggle("reject-line-error", Boolean(status.textContent));
  updateRemaining(line);
}

function updateRemaining(line: HTMLElement) {
  const remaining = lineField<HTMLInputElement>(line, "remaining");
  const quantity = lineField<HTMLInputElement>(line, "quantity");
  const available = Number(line.dataset.available ?? 0);
  const nextRemaining = remainingRejectedQuantity(quantity.value, available);
  remaining.value = quantity.value && nextRemaining !== null ? fmt(nextRemaining) : "";
}

function addLine() {
  const line = document.createElement("fieldset");
  line.className = "reject-line";
  line.innerHTML = `
    <legend>Batch line</legend>
    <button type="button" class="secondary reject-remove" aria-label="Remove batch line">Remove</button>
    <div class="reject-line-grid">
      <label class="field">Batch code<input data-field="batch" type="search" list="reject-batch-options" autocomplete="off" required /></label>
      <label class="field">Current available quantity<input data-field="original" type="text" readonly placeholder="Selected batch balance" /></label>
      <label class="field">Rejected quantity<input data-field="quantity" type="number" min="0.0001" step="0.0001" required /></label>
      <label class="field">New quantity after rejection<input data-field="remaining" type="text" readonly /></label>
      <p class="reject-line-status" data-field="balance-status" aria-live="polite"></p>
    </div>`;
  linesHost.append(line);

  lineField<HTMLInputElement>(line, "batch").addEventListener("input", () => refreshLineSelection(line));
  lineField<HTMLInputElement>(line, "quantity").addEventListener("input", () => updateRemaining(line));
  line.querySelector<HTMLButtonElement>(".reject-remove")!.addEventListener("click", () => {
    line.remove();
    hideReview();
  });

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
  if (!lineElements.length) return { errors: ["Add at least one batch line."], lines: [] as RejectionSubmissionLine[] };
  const found: string[] = [], lines: RejectionSubmissionLine[] = [];
  const keys = new Set<string>();

  for (const line of lineElements) {
    const batch = lineField<HTMLInputElement>(line, "batch").value.trim();
    const quantityText = lineField<HTMLInputElement>(line, "quantity").value;
    const quantity = Number(quantityText);
    const available = Number(line.dataset.available ?? 0);
    if (!batch) found.push("A batch code is required for every line.");
    const candidates = candidatesForBatch(batch);
    const resolution = resolveBatchBalance(candidates);
    if (batch && resolution.kind === "none") found.push(`Batch ${batch} has no positive current available quantity.`);
    if (batch && resolution.kind === "ambiguous") found.push(`Batch ${batch} has multiple current stock balances; submission is blocked until the inventory is clarified.`);
    const quantityError = validateRejectedQuantity(quantityText, available);
    if (quantityError) found.push(`Batch ${batch || "—"}: ${quantityError}`);
    if (batch) {
      const key = rejectionLineKey(batch, "", "");
      if (keys.has(key)) found.push(`Batch ${batch} is entered more than once; consolidate it into one line.`);
      keys.add(key);
    }
    if (batch && resolution.kind === "resolved" && !quantityError) {
      lines.push({ batch_code: batch, rejected_quantity: quantity });
    }
  }
  return { errors: [...new Set(found)], lines };
}

function showReview() {
  const result = validateLines();
  if (!reference.value.trim()) result.errors.unshift("Rejection reference is required.");
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
  table.innerHTML = "<thead><tr><th>Batch code</th><th class=\"num\">Current available</th><th class=\"num\">Rejected</th><th class=\"num\">New quantity</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const line of result.lines) {
    const balance = resolveBatchBalance(candidatesForBatch(line.batch_code));
    if (balance.kind !== "resolved") continue;
    const tr = document.createElement("tr");
    [
      line.batch_code,
      fmt(balance.option.available_quantity),
      fmt(line.rejected_quantity),
      fmt(balance.option.available_quantity - line.rejected_quantity),
    ].forEach((text, index) => {
      const td = document.createElement("td"); td.textContent = text;
      if (index > 0) td.className = "num";
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

async function loadOptions() {
  try {
    options = await fetchRejectionOptions();
    datalist.replaceChildren(...[...new Set(options.map((option) => option.batch_code))].map((batch) => {
      const item = document.createElement("option"); item.value = batch; return item;
    }));
    linesHost.querySelectorAll<HTMLElement>(".reject-line").forEach(refreshLineSelection);
  } catch (error) {
    message(error instanceof Error ? error.message : "Could not load rejection batches.", "error");
  }
}

export function loadRejects() {
  void loadOptions();
  void loadHistory();
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
  addLine();

  $<HTMLButtonElement>("#reject-add-line").addEventListener("click", () => addLine());
  $<HTMLButtonElement>("#reject-review").addEventListener("click", showReview);
  reference.addEventListener("input", hideReview);
  confirmButton.addEventListener("click", async () => {
    if (!reviewedLines) return;
    if (!reference.value.trim()) {
      errors.textContent = "Rejection reference is required.";
      errors.classList.remove("hidden");
      confirmActions.classList.remove("hidden");
      return;
    }
    confirmButton.disabled = true;
    try {
      const result = await submitLoadingRejection(reference.value.trim(), todayIso(), reviewedLines);
      message(`Rejection ${result?.rejection_reference ?? ""} saved successfully.`, "success");
      reference.value = "";
      linesHost.replaceChildren();
      addLine();
      hideReview();
      await loadHistory();
      void loadOptions();
    } catch (error) {
      errors.textContent = error instanceof Error ? error.message : "Could not save rejection.";
      errors.classList.remove("hidden");
      confirmActions.classList.remove("hidden");
    } finally {
      confirmButton.disabled = false;
    }
  });

  [historyBatch, historyFrom, historyTo].forEach((control) => {
    control.addEventListener(control instanceof HTMLInputElement && control.type === "search" ? "input" : "change", () => void loadHistory());
  });
}
