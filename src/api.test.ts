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

  it("combines quantities for item codes that differ only by hidden characters", () => {
    const stats = mapDashboardStats({
      items: [
        { item_code: "4554770147", description: "RF MR DG 10PPM", transactions: 2, quantity: 120, batches: 2, pallets: 2, destinations: 1, latest_date: "2026-10-27" },
        { item_code: "4554770\u200B147", description: "RF MR DG 10PPM", transactions: 1, quantity: 60, batches: 1, pallets: 1, destinations: 1, latest_date: "2026-10-28" },
      ],
    });

    expect(stats.items).toHaveLength(1);
    expect(stats.items[0].itemCode).toBe("4554770147");
    expect(stats.items[0].quantity).toBe(180);
  });
});
