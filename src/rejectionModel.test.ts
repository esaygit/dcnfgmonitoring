import { describe, expect, it } from "vitest";
import { rejectionLineKey, remainingRejectedQuantity, resolveBatchBalance, validateRejectedQuantity } from "./rejectionModel";

describe("rejection quantity validation", () => {
  it("calculates a remaining quantity", () => {
    expect(remainingRejectedQuantity(25, 100)).toBe(75);
  });
  it("rejects zero, negative, malformed, and excessive quantities", () => {
    expect(validateRejectedQuantity(0, 100)).toContain("greater than zero");
    expect(validateRejectedQuantity(-1, 100)).toContain("greater than zero");
    expect(validateRejectedQuantity("abc", 100)).toContain("greater than zero");
    expect(validateRejectedQuantity(101, 100)).toContain("cannot exceed");
  });
  it("allows decimal quantities within the available balance", () => {
    expect(validateRejectedQuantity("12.5", 100)).toBeNull();
    expect(remainingRejectedQuantity("12.5", 100)).toBe(87.5);
  });
  it("creates a normalized duplicate-line key", () => {
    expect(rejectionLineKey(" 63031H ", " 4554770121 ", " W49852 "))
      .toBe("63031h|4554770121|w49852");
  });
  it("only resolves a batch with one positive current balance", () => {
    const option = { available_quantity: 80, item_code: "I1", warehouse_code: "W1" };
    expect(resolveBatchBalance([option])).toEqual({ kind: "resolved", option });
    expect(resolveBatchBalance([{ ...option, available_quantity: 0 }])).toEqual({ kind: "none" });
    expect(resolveBatchBalance([option, { ...option, warehouse_code: "W2" }])).toEqual({ kind: "ambiguous" });
  });
});
