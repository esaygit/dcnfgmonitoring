import { describe, expect, it } from "vitest";
import { displayDate, normalizedDate, normalizedTime, transactionReferences } from "./utils";

describe("normalizedDate", () => {
  it("keeps ISO dates", () => expect(normalizedDate("2026-10-27")).toBe("2026-10-27"));
  it("reads month-first dates by default", () => expect(normalizedDate("10/27/2026")).toBe("2026-10-27"));
  it("reads day-first dates when asked", () => expect(normalizedDate("27/10/2026", false)).toBe("2026-10-27"));
  it("expands two-digit years", () => expect(normalizedDate("10/27/26")).toBe("2026-10-27"));
  it("rejects impossible dates", () => {
    expect(normalizedDate("13/45/2026")).toBe("");
    expect(normalizedDate("2026-02-30")).toBe("");
  });
  it("rejects text", () => expect(normalizedDate("not a date")).toBe(""));
});

describe("displayDate", () => {
  it("formats as MM-DD-YYYY", () => expect(displayDate("2026-10-27")).toBe("10-27-2026"));
  it("returns an empty string for bad input", () => expect(displayDate("")).toBe(""));
});

describe("normalizedTime", () => {
  it("pads 24-hour times", () => expect(normalizedTime("8:05")).toBe("08:05:00"));
  it("keeps seconds", () => expect(normalizedTime("14:32:10")).toBe("14:32:10"));
  it("converts PM", () => expect(normalizedTime("2:05 PM")).toBe("14:05:00"));
  it("handles midnight and noon", () => {
    expect(normalizedTime("12:00 AM")).toBe("00:00:00");
    expect(normalizedTime("12:30 PM")).toBe("12:30:00");
  });
  it("rejects invalid times", () => {
    expect(normalizedTime("25:00")).toBe("");
    expect(normalizedTime("10:75")).toBe("");
    expect(normalizedTime("noon")).toBe("");
  });
});

describe("transactionReferences", () => {
  it("lists unique references and names blank ones", () => {
    expect(transactionReferences(["GAA1", "GAA1", " "])).toBe("GAA1, not entered");
  });
});
