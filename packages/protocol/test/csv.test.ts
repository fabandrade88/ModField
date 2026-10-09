import { describe, expect, it } from "vitest";
import { importRegisterMap, parseCsv } from "../src";

describe("parseCsv", () => {
  it("detects ; and handles quotes", () => {
    expect(parseCsv('a;b;c\n1;"x;y";"say ""hi"""\r\n\n')).toEqual([
      ["a", "b", "c"],
      ["1", "x;y", 'say "hi"'],
    ]);
  });
});

describe("importRegisterMap", () => {
  const csv = [
    "tag,descricao,unit_id,funcao,endereco,tipo,ordem,bruto_min,bruto_max,eng_min,eng_max,unidade,casas",
    "PT-101,Pressão recalque,5,holding,1,FLOAT32,CDAB,,,,,bar,2",
    "LT-200,Nível,,input,10,UINT16,,0,10000,0,100,%,1",
    "XV-1,,,coil,1,,,,,,,,",
    "BAD,,,holding,0,FLOAT99,,,,,,,",
  ].join("\n");

  it("imports rows, applies base and default unit", () => {
    const rows = importRegisterMap(csv, { base: 1, defaultUnitId: 3 });
    expect(rows[0]!.tag).toMatchObject({ name: "PT-101", unitId: 5, table: "holding", offset: 0, type: "FLOAT32", order: "CDAB", unit: "bar", decimals: 2 });
    expect(rows[1]!.tag).toMatchObject({ unitId: 3, table: "input", offset: 9, scale: { rawMin: 0, rawMax: 10000, engMin: 0, engMax: 100 } });
    expect(rows[2]!.tag).toMatchObject({ table: "coil", offset: 0, type: "UINT16" });
  });

  it("reports errors per line", () => {
    const rows = importRegisterMap(csv, { base: 1, defaultUnitId: 3 });
    expect(rows[3]).toMatchObject({ line: 5 });
    expect(rows[3]!.errors).toEqual([
      { code: "badAddress", value: "0" }, // 0 is invalid in base 1
      { code: "badType", value: "FLOAT99" },
    ]);
  });

  it("accepts classic notation without a funcao column", () => {
    const rows = importRegisterMap("tag;endereco;tipo\nFT;400101;FLOAT32\nT;30005;INT16", { base: 0, defaultUnitId: 1 });
    expect(rows.map((r) => [r.tag?.table, r.tag?.offset])).toEqual([
      ["holding", 100],
      ["input", 4],
    ]);
  });

  it("flags an incomplete scale", () => {
    const rows = importRegisterMap("tag,funcao,endereco,bruto_min\nX,holding,0,4", { base: 0, defaultUnitId: 1 });
    expect(rows[0]!.errors).toEqual([{ code: "partialScale" }]);
  });
});
