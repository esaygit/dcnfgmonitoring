import { $ } from "../dom";
import type { Transfer } from "../types";
import { displayDate, fmt } from "../utils";

const drawer = $<HTMLElement>("#drawer"), backdrop = $<HTMLElement>("#drawer-backdrop"), body = $<HTMLElement>("#drawer-body"), title = $<HTMLElement>("#drawer-title"), closeButton = $<HTMLButtonElement>("#drawer-close");
let lastFocus: HTMLElement | null = null;

function addDetail(list: HTMLElement, label: string, value: string) {
  const dt = document.createElement("dt"), dd = document.createElement("dd");
  dt.textContent = label; dd.textContent = value || "—";
  list.append(dt, dd);
}

function buildDetails(members: Transfer[]) {
  const first = members[0], wrap = document.createElement("div");
  wrap.className = "drawer-content";

  const total = members.reduce((sum, transfer) => sum + Number(transfer.quantity || 0), 0);
  const sources = [...new Set(members.map((transfer) => transfer.source_filename).filter((value): value is string => Boolean(value)))];
  const pallets = [...new Set(members.flatMap((transfer) => transfer.pallets))];
  const imported = members.map((transfer) => transfer.created_at).sort()[0];

  const details = document.createElement("dl");
  details.className = "detail-grid";
  addDetail(details, "Document date", displayDate(first.document_date));
  addDetail(details, "Document time", first.document_time ? first.document_time.slice(0, 5) : "");
  addDetail(details, "From", first.transferred_from);
  addDetail(details, "To", first.transferred_to);
  addDetail(details, "Item", `${first.item_code}\n${first.description}`);
  addDetail(details, "Product code", first.product_code ?? "");
  addDetail(details, "Total quantity", fmt(total));
  addDetail(details, "Pallets", pallets.join(", "));
  addDetail(details, "Source file", sources.join("\n"));
  addDetail(details, "Imported", imported ? new Date(imported).toLocaleString() : "");
  wrap.append(details);

  if (members.some((transfer) => transfer.is_duplicate)) {
    const warning = document.createElement("p");
    warning.className = "duplicate-warning";
    warning.textContent = "A batch in this transaction matches another saved record (same batch code, quantity and pallet).";
    wrap.append(warning);
  }

  const section = document.createElement("section"), heading = document.createElement("h3"), scroller = document.createElement("div"), table = document.createElement("table");
  heading.textContent = `Batches (${members.length})`;
  scroller.className = "table-wrap";
  table.innerHTML = "<thead><tr><th>Batch code</th><th class=\"num\">Quantity</th><th>Pallets</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const transfer of members) {
    const tr = document.createElement("tr");
    const cells = [transfer.batch_code ?? "—", fmt(Number(transfer.quantity || 0)), transfer.pallets.join(", ") || "—"];
    cells.forEach((text, index) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (index === 1) td.className = "num";
      tr.append(td);
    });
    const flag = document.createElement("td");
    if (transfer.is_duplicate) { const badge = document.createElement("span"); badge.className = "dup-badge"; badge.textContent = "Possible duplicate"; flag.append(badge); }
    tr.append(flag);
    tbody.append(tr);
  }
  table.append(tbody);
  scroller.append(table);
  section.append(heading, scroller);
  wrap.append(section);
  return wrap;
}

export function openDrawer(members: Transfer[], trigger?: HTMLElement) {
  if (!members.length) return;
  lastFocus = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  title.textContent = members[0].transaction_reference || "Transaction";
  body.replaceChildren(buildDetails(members));
  drawer.classList.remove("hidden"); backdrop.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("drawer-open");
  closeButton.focus();
}

export function closeDrawer() {
  if (drawer.classList.contains("hidden")) return;
  drawer.classList.add("hidden"); backdrop.classList.add("hidden");
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("drawer-open");
  lastFocus?.focus();
  lastFocus = null;
}

export function initDrawer() {
  closeButton.addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
}
