import type { Row, Worksheet } from "exceljs";
import type { Transfer } from "../types";
import { displayDate, normalizedDate } from "../utils";
import { message } from "./toast";

/** Describes the filters the exported list was fetched with. */
export type ExportContext = { text: string; from: string; to: string; batch: string };

export async function exportToExcel(list: Transfer[], ctx: ExportContext) {
  if (!list.length) { message("There are no records to export.", "error"); return; }
  message("Building workbook…", "", 0);
  try {
    const { default: ExcelJS } = await import("exceljs");
    const INK = "FF0F2A3A", SKY = "FF79BEEE", TINT = "FFEEF7FD", BAND = "FFF7FBFE", LINE = "FFD3E4F0", MUTED = "FF4D6779";
    const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
    const hair = { style: "thin" as const, color: { argb: LINE } };
    const now = new Date(), stamp = now.toISOString().slice(0, 10);
    const filterText = ctx.text;
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
    const safeBatch = ctx.batch.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 20);
    const filenameParts = ["dcn-fg-transfers", ctx.from ? `from-${ctx.from.replaceAll("-", "")}` : "", ctx.to ? `to-${ctx.to.replaceAll("-", "")}` : "", safeBatch ? `batch-${safeBatch}` : "", `generated-${generatedAt}`].filter(Boolean);
    link.download = `${filenameParts.join("_")}.xlsx`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    message(`${list.length} record${list.length === 1 ? "" : "s"} exported to Excel.`, "success");
  } catch (error) {
    message(error instanceof Error ? `Could not build the workbook: ${error.message}` : "Could not build the workbook.", "error");
  }
}
