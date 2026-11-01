import { describe, expect, it } from "vitest";
import { parseRecordFilters, serializeRecordFilters } from "./recordFilterUrl";
import type { RecordFilters } from "./types";

const filters: RecordFilters = {
  query: "GAA 12",
  dateFrom: "2026-10-01",
  dateTo: "",
  batch: "B 1",
  item: "",
  sort: "date-desc",
  fromWarehouse: "W01",
  toWarehouse: "",
  pallet: "1001",
};

describe("record filter URLs", () => {
  it("round-trips active filters with URL encoding", () => {
    expect(parseRecordFilters(serializeRecordFilters(filters))).toEqual(filters);
  });

  it("falls back to a safe sort mode for an invalid URL value", () => {
    expect(parseRecordFilters("sort=unexpected").sort).toBe("date-desc");
  });
});
