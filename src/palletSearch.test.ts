import { describe, expect, it } from "vitest";

export function palletMatchesExactly(pallets: string[], search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return pallets.some((pallet) => pallet.trim().toLowerCase() === needle);
}

describe("pallet exact matching", () => {
  it("matches case-insensitively and completely", () => {
    expect(palletMatchesExactly(["1001", "ABC2"], "abc2")).toBe(true);
  });
  it("does not match partial pallet numbers", () => {
    expect(palletMatchesExactly(["10010"], "1001")).toBe(false);
  });
});
