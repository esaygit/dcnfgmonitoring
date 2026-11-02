import { describe, expect, it } from "vitest";
import { parseRecordFilters } from "./recordFilterUrl";

describe("record filter URLs", () => {
  it("reads legacy filter links and decodes their active filters", () => {
    expect(parseRecordFilters("query=GAA+12&from=2026-10-01&batch=B+1")).toEqual({
      query: "GAA 12",
      dateFrom: "2026-10-01",
      dateTo: "",
      batch: "B 1",
      item: "",
      sort: "date-desc",
    });
  });

  it("falls back to a safe sort mode for an invalid URL value", () => {
    expect(parseRecordFilters("sort=unexpected").sort).toBe("date-desc");
  });

  it("ignores removed warehouse and pallet filters in old shared URLs", () => {
    expect(parseRecordFilters("fromWarehouse=W01&toWarehouse=W22&pallet=1001")).toEqual({
      query: "",
      dateFrom: "",
      dateTo: "",
      batch: "",
      item: "",
      sort: "date-desc",
    });
  });
});
