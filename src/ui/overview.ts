import { $, emptyRow } from "../dom";
import { fetchRecords, fetchStats } from "../api";
import { groupTransfers, stackLines } from "../grouping";
import { displayDate } from "../utils";
import { message } from "./toast";

const recentBody = $<HTMLTableSectionElement>("#recent-table tbody");

export async function loadOverview() {
  try {
    const [stats, recent] = await Promise.all([
      fetchStats(null, null),
      fetchRecords({ query: "", dateFrom: "", dateTo: "", batch: "", item: "", sort: "date-desc" }, 0, 6),
    ]);
    $<HTMLElement>("#total-records").textContent = stats.records.toLocaleString();
    $<HTMLElement>("#total-quantity").textContent = stats.quantity.toLocaleString();
    $<HTMLElement>("#total-references").textContent = stats.references.toLocaleString();
    $<HTMLElement>("#total-destinations").textContent = stats.destinations.toLocaleString();

    recentBody.innerHTML = "";
    const labels = ["Reference", "Date", "From", "To", "Description", "Quantity"];
    for (const members of groupTransfers(recent.rows)) {
      const [first] = members, tr = document.createElement("tr");
      [first.transaction_reference, displayDate(first.document_date, true), first.transferred_from, first.transferred_to, first.description, stackLines(members, (transfer) => String(transfer.quantity))].forEach((value, index) => {
        const td = document.createElement("td");
        td.dataset.label = labels[index];
        td.textContent = value;
        if (index === 5) td.className = "num stacked";
        tr.append(td);
      });
      recentBody.append(tr);
    }
    if (!recent.rows.length) emptyRow(recentBody, 6, "Nothing here yet. Import an IWTS PDF to see your latest transfers.");
  } catch (error) {
    message(`Could not load the overview: ${error instanceof Error ? error.message : "unexpected error"}`, "error");
  }
}
