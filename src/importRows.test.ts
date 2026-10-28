import { describe, expect, it } from "vitest";
import { HEADERS, type ImportRow } from "./constants";
import { groupTransfers, palletLines, stackLines } from "./grouping";
import { localDuplicateIndex, sameQuantityAndPallet, sortReviewRows, toProbe } from "./importRows";
import type { Transfer } from "./types";

const makeRow = (overrides: Partial<ImportRow> = {}): ImportRow => ({ ...Object.fromEntries(HEADERS.map((header) => [header, ""])), ...overrides }) as ImportRow;

describe("sameQuantityAndPallet", () => {
  const base = { quantity: "100", pallets: "1001, 1002", batch: "B1", item: "4554770121" };
  it("matches the same batch, quantity and a shared pallet", () => expect(sameQuantityAndPallet(base, { ...base, pallets: "1002" })).toBe(true));
  it("ignores thousands separators in the quantity", () => expect(sameQuantityAndPallet({ ...base, quantity: "1,000" }, { ...base, quantity: 1000, pallets: ["1001"] })).toBe(true));
  it("does not match a different batch", () => expect(sameQuantityAndPallet(base, { ...base, batch: "B2" })).toBe(false));
  it("does not match a different quantity", () => expect(sameQuantityAndPallet(base, { ...base, quantity: "101" })).toBe(false));
  it("does not match without a shared pallet", () => expect(sameQuantityAndPallet(base, { ...base, pallets: "9999" })).toBe(false));
  it("does not match different item codes", () => expect(sameQuantityAndPallet(base, { ...base, item: "4554770128" })).toBe(false));
});

describe("localDuplicateIndex", () => {
  it("finds another row with the same batch, quantity and pallet", () => {
    const rows = [
      makeRow({ "Batch Code": "B1", Quantity: "100", Pallets: "1001, 1002" }),
      makeRow({ "Batch Code": "B1", Quantity: "100", Pallets: "1002" }),
      makeRow({ "Batch Code": "B2", Quantity: "100", Pallets: "1002" }),
      makeRow({ "Batch Code": "B1", Quantity: "100", Pallets: "9999" }),
    ];
    expect(localDuplicateIndex(rows, 0)).toBe(1);
    expect(localDuplicateIndex(rows, 1)).toBe(0);
    expect(localDuplicateIndex(rows, 2)).toBe(-1); // different batch of the same transaction is fine
    expect(localDuplicateIndex(rows, 3)).toBe(-1);
  });
});

describe("toProbe", () => {
  it("cleans the row for the database check", () => {
    expect(toProbe(makeRow({ "Batch Code": " B1 ", "Item Code": "4554770121", Quantity: "1,200", Pallets: "1001, 1002" }))).toEqual({ batch: "B1", item: "4554770121", quantity: 1200, pallets: ["1001", "1002"] });
  });
  it("sends null for a missing or invalid quantity", () => {
    expect(toProbe(makeRow({ Quantity: "" })).quantity).toBeNull();
    expect(toProbe(makeRow({ Quantity: "12abc" })).quantity).toBeNull();
  });
});

describe("sortReviewRows", () => {
  it("orders by date and PDF time, undated rows last, keeping rows of one PDF together", () => {
    const a1 = makeRow({ "Document Date": "2026-10-27", "Batch Code": "A1" });
    const a2 = makeRow({ "Document Date": "2026-10-27", "Batch Code": "A2" });
    const b = makeRow({ "Document Date": "2026-10-27", "Batch Code": "B" });
    const c = makeRow({ "Document Date": "2026-10-26", "Batch Code": "C" });
    const manual = makeRow({ "Batch Code": "M" });
    const times = new Map<ImportRow, string>([[a1, "14:00:00"], [a2, "14:00:00"], [b, "08:00:00"], [c, "23:00:00"]]);
    const rows = [manual, a1, a2, b, c];
    sortReviewRows(rows, (row) => times.get(row));
    expect(rows.map((row) => row["Batch Code"])).toEqual(["C", "B", "A1", "A2", "M"]);
  });
});

const transfer = (overrides: Partial<Transfer>): Transfer => ({
  id: "1", transaction_reference: "GAA1", document_date: "2026-10-27", document_time: null, transferred_from: "W01", transferred_to: "W22",
  item_code: "4554770121", description: "RF MR EXP 50PPM", product_code: "P1", batch_code: "B1", quantity: 100, pallets: ["1001"], source_filename: null, created_at: "2026-10-27T00:00:00Z", ...overrides,
});

describe("groupTransfers", () => {
  it("groups the batches of one transaction and keeps the incoming order", () => {
    const groups = groupTransfers([transfer({ id: "1", batch_code: "B1" }), transfer({ id: "2", transaction_reference: "GAA2" }), transfer({ id: "3", batch_code: "B2" })]);
    expect(groups.map((group) => group.map((t) => t.id))).toEqual([["1", "3"], ["2"]]);
  });
});

describe("palletLines", () => {
  it("wraps three pallets per line", () => expect(palletLines(["1", "2", "3", "4"])).toBe("1, 2, 3,\n4"));
  it("returns an empty string for no pallets", () => expect(palletLines([])).toBe(""));
});

describe("stackLines", () => {
  it("puts one line per batch and a dash for blanks when there are several", () => {
    expect(stackLines([transfer({ batch_code: "B1" }), transfer({ batch_code: null })], (t) => t.batch_code ?? "")).toBe("B1\n—");
  });
});
