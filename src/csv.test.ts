import { describe, expect, it } from "vitest";
import { recordsToCsv } from "./csv";
import type { Transfer } from "./types";

const transfer: Transfer = {
  id: "1",
  transaction_reference: "GAA, 123",
  document_date: "2026-10-27",
  document_time: "08:05:00",
  transferred_from: "W01",
  transferred_to: "W22",
  item_code: "4554770121",
  description: 'Fiber "fine"',
  product_code: null,
  batch_code: "B1",
  quantity: 1200,
  pallets: ["1001", "1002"],
  source_filename: "transfer.pdf",
  created_at: "2026-10-27T00:00:00Z",
};

describe("recordsToCsv", () => {
  it("quotes fields, escapes embedded quotes, and emits consistent dates and numbers", () => {
    expect(recordsToCsv([transfer])).toContain('"GAA, 123","27/10/2026","08:05","W01"');
    expect(recordsToCsv([transfer])).toContain('"Fiber ""fine"""');
    expect(recordsToCsv([transfer])).toContain('"1,200"');
  });

  it("returns only the header for an empty export", () => {
    expect(recordsToCsv([]).split("\r\n")).toHaveLength(1);
  });
});
