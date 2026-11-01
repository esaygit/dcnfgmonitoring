import { describe, expect, it } from "vitest";
import { mapDashboardStats } from "./api";

describe("mapDashboardStats", () => {
  it("maps transaction counts returned by dashboard_stats", () => {
    const stats = mapDashboardStats({
      records: 12,
      quantity: 240,
      references: 8,
      destinations: 3,
      items: [{
        item_code: "4554770121",
        description: "RF MR EXP 50PPM",
        transactions: 4,
        quantity: 120,
        batches: 5,
        pallets: 2,
        destinations: 1,
        latest_date: "2026-10-27",
      }],
    });

    expect(stats.items[0].transactions).toBe(4);
    expect(stats.items[0].quantity / stats.items[0].transactions).toBe(30);
  });
});
