import { describe, expect, it } from "vitest";
import { canonicalItemCode, groupForItemCode, itemCodesFor, itemFilterName } from "./constants";

describe("groupForItemCode", () => {
  it("recognizes item codes with surrounding whitespace", () => {
    expect(groupForItemCode(" 4554770148 ")).toBe("10 PPM");
    expect(groupForItemCode("4554770147")).toBe("10 PPM");
  });

  it("recognizes item codes containing invisible formatting characters", () => {
    expect(groupForItemCode("4554770\u200B147")).toBe("10 PPM");
  });

  it("returns no group for item codes outside the configured lists", () => {
    expect(groupForItemCode("4554770999")).toBeUndefined();
  });
});

describe("canonicalItemCode", () => {
  it("removes whitespace and invisible formatting characters", () => {
    expect(canonicalItemCode(" 4554770\u200B147 ")).toBe("4554770147");
  });
});

describe("item series filters", () => {
  it("maps chart series filters to the exact export or downgraded item codes", () => {
    expect(itemCodesFor("group:50 PPM:exports")).toEqual(["4554770121", "4554770136"]);
    expect(itemCodesFor("group:50 PPM:downgraded")).toEqual(["4554770128", "4554770130"]);
    expect(itemCodesFor("group:10 PPM:exports")).toEqual(["4554770148", "4554770149"]);
    expect(itemCodesFor("group:10 PPM:downgraded")).toEqual(["4554770147", "4554770150"]);
    expect(itemFilterName("group:50 PPM:exports")).toBe("50 PPM exports");
  });
});
