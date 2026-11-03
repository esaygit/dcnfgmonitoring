import { describe, expect, it } from "vitest";
import { analyticsRecordsHref, bucketRange, bucketStart, buildBuckets, comparisonRange, percentChange, summarizeQuality } from "./analyticsModel";
import type { Transfer } from "./types";

const transfer = (overrides: Partial<Transfer>): Transfer => ({
  id: "record",
  transaction_reference: "REF-1",
  document_date: "2026-10-12",
  document_time: null,
  transferred_from: "DCN",
  transferred_to: "WH1",
  item_code: "4554770121",
  description: "Export 50 PPM",
  product_code: null,
  batch_code: null,
  quantity: 10,
  pallets: [],
  source_filename: null,
  created_at: "2026-10-12T00:00:00Z",
  ...overrides,
});

describe("analytics time buckets", () => {
  it("uses calendar day, Monday-based week, and month starts", () => {
    expect(bucketStart("2026-10-12", "day")).toBe("2026-10-12");
    expect(bucketStart("2026-10-14", "week")).toBe("2026-10-12");
    expect(bucketStart("2026-10-14", "month")).toBe("2026-10-01");
  });

  it("limits record links to the selected date range inside each bucket", () => {
    expect(bucketRange("2026-10-12", "week", "2026-10-14", "2026-10-15")).toEqual({ from: "2026-10-14", to: "2026-10-15" });
    expect(analyticsRecordsHref("2026-10-14", "2026-10-15", "group:50 PPM:exports")).toBe(
      "#/records?from=2026-10-14&to=2026-10-15&item=group%3A50+PPM%3Aexports",
    );
  });

  it("combines export and downgraded quantities into their own PPM series", () => {
    const buckets = buildBuckets([
      transfer({ id: "export", quantity: 30 }),
      transfer({ id: "downgraded", item_code: "4554770128", quantity: 12 }),
      transfer({ id: "export-10", item_code: "4554770148", quantity: 8 }),
      transfer({ id: "downgraded-10", item_code: "4554770147", quantity: 3 }),
    ], "2026-10-12", "2026-10-13", "day");

    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ key: "2026-10-12", exports50: 30, downgraded50: 12, ppm50: 42, exports10: 8, downgraded10: 3, ppm10: 11 });
    expect(buckets[1]).toMatchObject({ key: "2026-10-13", exports50: 0, downgraded50: 0, ppm50: 0 });
  });

  it("uses the configured 10 PPM export and downgraded item pairs", () => {
    const [bucket] = buildBuckets([
      transfer({ id: "export-a", item_code: "4554770148", quantity: 6 }),
      transfer({ id: "export-b", item_code: "4554770149", quantity: 4 }),
      transfer({ id: "dg-a", item_code: "4554770147", quantity: 3 }),
      transfer({ id: "dg-b", item_code: "4554770150", quantity: 2 }),
    ], "2026-10-12", "2026-10-12", "day");

    expect(bucket).toMatchObject({ exports10: 10, downgraded10: 5, ppm10: 15, ppm50: 0 });
  });

  it("counts missing codes, unlisted codes, and flagged duplicates by their week", () => {
    const summary = summarizeQuality([
      transfer({ id: "missing", item_code: "", is_duplicate: true }),
      transfer({ id: "unknown", item_code: "UNKNOWN", is_duplicate: true, document_date: "2026-10-13" }),
    ]);

    expect(summary.missingItemCode).toBe(1);
    expect(summary.unlistedItemCodes).toEqual([{ itemCode: "UNKNOWN", records: 1 }]);
    expect(summary.duplicateRecords).toBe(2);
    expect(summary.duplicatesByWeek).toEqual([{ week: "2026-10-12", records: 2 }]);
  });
});

describe("period comparison", () => {
  it("returns an immediately preceding range with the same inclusive number of days", () => {
    expect(comparisonRange("2026-10-01", "2026-10-30")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("does not compare an open-ended or reversed range", () => {
    expect(comparisonRange("2026-10-01", "")).toBeNull();
    expect(comparisonRange("2026-10-31", "2026-10-01")).toBeNull();
  });

  it("does not invent a percentage change when the previous period is zero", () => {
    expect(percentChange(112, 100)).toBe(12);
    expect(percentChange(0, 0)).toBeNull();
  });
});
