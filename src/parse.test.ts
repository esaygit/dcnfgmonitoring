import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { batchesFromFilename, palletsFromFilename, parse, pdfTime } from "./parse";

// TEXT is synthetic; the sanitized IWTS fixture below is extracted from a user-supplied PDF.
const TEXT = "TRANSFER DOCUMENT GAA 123456 DOCUMENT DATE : 2026-10-27 DOCUMENT TIME : 14:32:10 SHIP FROM : W01 SHIP TO : W22 4554770121 RF MR EXP 50PPM 0041234LOC B240101 1,200 BAGS";
const IWTS_FIXTURE = readFileSync(join(import.meta.dirname, "fixtures", "iwts-interwarehouse-transfer.txt"), "utf8");

// Text of a real two-lot slip (one item, two lots), as pdf.js returns it.
const TWO_LOT_TEXT = "490 COCO HARVEST INCORPORATED IWTS G01 CTANGUB IWTS | GAA021083 Interwarehouse Transfer Slip SHIP FROM :W49401 CHI Plant DCN Production Whse DOCUMENT DATE: 11-01-26 08:37:00 SHIP TO : W49852 CHI FG Albatross DCN Whse LOG DATE : ADDRESS : ADD033840 Purok 7, Labinay ARRIVAL DATE : 11-01-2026 08:37 Shipment/line Item Code/Description Location Lot Quantity Unt Weight EQ. Wht EQ.CBM / 4554770121RF DCN MR 50PPM SULF 25KG H14WLOC 63031H-RF-MR-EXPORT 10.00 25S * / 4554770121RF DCN MR 50PPM SULF 25KG H14WLOC 63041H-RF-MR-EXPORT 130.00 25S * Total Item : 2 T O T A L < TN/CASE/OTHERS > 140.00 REMARKS : RF MR EXPORT TRANSFER TO ALBATROSS WHSE";

describe("pdfTime", () => {
  it("reads DOCUMENT TIME", () => expect(pdfTime("DOCUMENT DATE: 2026-10-27 DOCUMENT TIME: 08:15:30")).toBe("08:15:30"));
  it("reads a time right after the document date", () => expect(pdfTime("DOCUMENT DATE: 2026-10-27 14:32 SHIP FROM")).toBe("14:32:00"));
  it("reads a 12-hour time", () => expect(pdfTime("DOCUMENT DATE: 10/27/2026 2:05 PM")).toBe("14:05:00"));
  it("falls back to a bare TIME label", () => expect(pdfTime("PRINT TIME: 09:00")).toBe("09:00:00"));
  it("returns an empty string when there is no time", () => expect(pdfTime("DOCUMENT DATE: 2026-10-27 SHIP FROM : W01")).toBe(""));
});

describe("palletsFromFilename", () => {
  it("reads the pallet numbers before the date", () => expect(palletsFromFilename("PALLETS 1234 1235 1236 20261027.pdf")).toBe("1234, 1235, 1236"));
  it("accepts the singular", () => expect(palletsFromFilename("PALLET 777 20261027.pdf")).toBe("777"));
  it("returns an empty string without pallets", () => expect(palletsFromFilename("IWTS 20261027.pdf")).toBe(""));
  it("reads file names where spaces became underscores", () => expect(palletsFromFilename("GAA1_RF_PALLET_3105_3106_3107.pdf")).toBe("3105, 3106, 3107"));
});

describe("batchesFromFilename", () => {
  it("reads one entry per batch", () => {
    expect(batchesFromFilename("PALLETS 100 AB12345-X 40 BAGS CD67890 60 BAGS.pdf")).toEqual([
      { batch: "AB12345-X", quantity: "40" },
      { batch: "CD67890", quantity: "60" },
    ]);
  });
  it("returns nothing when the name has no batches", () => expect(batchesFromFilename("PALLETS 100 20261027.pdf")).toEqual([]));
  it("reads file names where spaces became underscores", () => {
    expect(batchesFromFilename("GAA021083_RF_MR_EXPORT_63031H_10_BAGS_63041H_130_BAGS_PALLET_3105.pdf")).toEqual([
      { batch: "63031H", quantity: "10" },
      { batch: "63041H", quantity: "130" },
    ]);
  });
});

describe("parse", () => {
  it("extracts transfer rows from a sanitized real IWTS interwarehouse slip", () => {
    const filename = "GAA000001 RF MR EXPORT (10 PPM) 00001H 60 BAGS PALLET 1001 1002 1003 10032026.pdf";
    const result = parse(IWTS_FIXTURE, filename);

    expect(pdfTime(IWTS_FIXTURE)).toBe("15:41:00");
    expect(result.filenameBatches).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      "Transaction Reference": "GAA000001",
      "Document Date": "2026-10-03",
      "Transferred From": "W00001",
      "Transferred To": "W00002",
      "Item Code": "4554770121",
      "Description": "RF DCN MR 50PPM SULF 25KG",
      "Product Code": "H14W",
      "Batch Code": "00001H-RF-MR-EXPORT",
      "Quantity": "60.00",
      "Pallets": "1001, 1002, 1003",
    });
  });

  it("reads the product code before LOC and the lot as the batch code on a two-lot slip", () => {
    const filename = "GAA021083_RF_MR_EXPORT_63031H_10_BAGS_63041H_130_BAGS_PALLET_3105_3106_3107_3108_3109_3110_3111.pdf";
    const { rows, filenameBatches } = parse(TWO_LOT_TEXT, filename);

    expect(pdfTime(TWO_LOT_TEXT)).toBe("08:37:00");
    expect(filenameBatches).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row["Item Code"] === "4554770121" && row.Description === "RF DCN MR 50PPM SULF 25KG" && row["Product Code"] === "H14W")).toBe(true);
    expect(rows.map((row) => row["Batch Code"])).toEqual(["63031H-RF-MR-EXPORT", "63041H-RF-MR-EXPORT"]);
    expect(rows.map((row) => row.Quantity)).toEqual(["10.00", "130.00"]);
    expect(rows[0]).toMatchObject({ "Transaction Reference": "GAA021083", "Document Date": "2026-11-01", "Transferred From": "W49401", "Transferred To": "W49852", Pallets: "3105, 3106, 3107, 3108, 3109, 3110, 3111" });
  });

  it("still reads the product code when pdf.js puts a space before LOC", () => {
    const { rows } = parse(TWO_LOT_TEXT.replace(/H14WLOC/g, "O14W LOC"), "x.pdf");
    expect(rows.map((row) => row["Product Code"])).toEqual(["O14W", "O14W"]);
    expect(rows[0].Description).toBe("RF DCN MR 50PPM SULF 25KG");
  });

  it("extracts the header fields and one item line", () => {
    const { rows, filenameBatches } = parse(TEXT, "PALLETS 1001 1002 20261027.pdf");
    expect(filenameBatches).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      "Transaction Reference": "GAA123456",
      "Document Date": "2026-10-27",
      "Transferred From": "W01",
      "Transferred To": "W22",
      "Item Code": "4554770121",
      "Description": "RF MR EXP 50PPM",
      "Product Code": "0041234",
      "Batch Code": "B240101",
      "Quantity": "1,200",
      "Pallets": "1001, 1002",
    });
  });

  it("splits one item line into several rows when the filename lists several batches", () => {
    const { rows, filenameBatches } = parse(TEXT, "IWTS PALLETS 1001 1002 20261027 B240101 700 BAGS B240102 500 BAGS.pdf");
    expect(filenameBatches).toBe(2);
    expect(rows.map((row) => row["Batch Code"])).toEqual(["B240101", "B240102"]);
    expect(rows.map((row) => row.Quantity)).toEqual(["700", "500"]);
    expect(rows.every((row) => row["Item Code"] === "4554770121")).toBe(true);
  });

  it("returns one blank row when nothing can be read", () => {
    const { rows } = parse("", "scan.pdf");
    expect(rows).toHaveLength(1);
    expect(rows[0]["Item Code"]).toBe("");
    expect(rows[0]["Transaction Reference"]).toBe("");
  });
});
