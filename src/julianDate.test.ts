import { describe, expect, it } from "vitest";
import { julianDateFromBatch } from "./julianDate";

describe("julianDateFromBatch", () => {
  it("converts YDDD to a calendar date", () => {
    expect(julianDateFromBatch("63281H-RF-MR-EXPORT")).toEqual({
      year: 2026,
      day: 328,
      date: "2026-11-24",
    });
  });
  it("maps digit 3 to 2023", () => {
    expect(julianDateFromBatch("30011X")?.date).toBe("2023-01-01");
  });
  it("accepts leap-year day 366", () => {
    expect(julianDateFromBatch("43661X")?.date).toBe("2024-12-31");
  });
  it("rejects day 366 in a non-leap year", () => {
    expect(julianDateFromBatch("63661X")).toBeNull();
  });
  it("rejects malformed and impossible codes", () => {
    expect(julianDateFromBatch("")).toBeNull();
    expect(julianDateFromBatch("ABC")).toBeNull();
    expect(julianDateFromBatch("70001X")).toBeNull();
  });
});
