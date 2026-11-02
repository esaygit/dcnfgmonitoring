import { describe, expect, it } from "vitest";
import { groupForItemCode } from "./constants";

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
