import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { BlockBuilder, emptyBlock, toSeries, trimmed } from "@modfield/series";
import { band, canonicalCsv, evaluate, finalizePdf, attachmentNames, readIntegrity, sha256Hex, signMessage, toB64url, verifyReport, verifySignature, type ReportData } from "../src";
import { ReportDocument } from "../src/document";

describe("evaluate", () => {
  const base = { id: "t", tagId: "x", expected: 6.2, tolerance: { kind: "abs" as const, value: 0.1 } };
  it("passes inside the band, including the edges", () => {
    expect(band(100, { kind: "pct", value: 0.5 })).toEqual([99.5, 100.5]);
    expect(evaluate({ ...base, measured: { value: 6.3, how: "capture", at: 0 } }).verdict).toBe("pass");
    expect(evaluate({ ...base, measured: { value: 6.31, how: "capture", at: 0 } }).verdict).toBe("fail");
    expect(evaluate(base).verdict).toBe("pending");
  });
  it("needs a justification to override", () => {
    expect(evaluate({ ...base, override: { result: "pass", justification: "Sensor substituído; reteste agendado" } })).toMatchObject({ verdict: "pass", manual: true });
    expect(() => evaluate({ ...base, override: { result: "pass", justification: "  " } })).toThrow(/justification/);
  });
});

function sampleCsv() {
  const b = emptyBlock("p", 0);
  const w = new BlockBuilder(b);
  for (let i = 0; i < 5; i++) w.push(1_760_000_000_000 + i * 1000, 6.2 + i / 100, 0);
  return canonicalCsv([{ id: "p", name: "PT-101" }], new Map([["p", toSeries([trimmed(b)])]]));
}

describe("integrity", () => {
  it("hashes the canonical CSV", async () => {
    const { bytes, rows } = sampleCsv();
    expect(rows).toBe(5);
    expect(await sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifies an Ed25519 signature over the hash only", async () => {
    const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pub = toB64url(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)));
    const hash = "ab".repeat(32);
    const sig = toB64url(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, keys.privateKey, signMessage(hash))));
    expect(await verifySignature(pub, hash, sig)).toBe(true);
    expect(await verifySignature(pub, "cd".repeat(32), sig)).toBe(false);
  });
});

describe("PDF", () => {
  const data = (over: Partial<ReportData> = {}): ReportData => ({
    lang: "pt",
    number: "MF-2026-001",
    date: "10/10/2026",
    appVersion: "0.5.0",
    company: { name: "Automação Exemplo Ltda.", taxId: "00.000.000/0001-00", address: "Rua A, 1", phone: "", email: "", website: "" },
    sections: { identification: true, equipment: true, communication: true, tests: true, writes: true, scans: true, trends: true, observations: true, signatures: true },
    identification: { client: "Cliente S.A.", plant: "ETA 2", area: "Bombeamento", project: "OS 4512", responsible: "Técnico" },
    equipment: [{ manufacturer: "ModField", model: "INV-7.5", serialNumber: "123", tag: "Inversor", unitId: 1, firmware: "1.4.2" }],
    communication: [{ label: "Protocolo", value: "Modbus RTU 19200 8E1" }],
    tests: [{ tag: "PT-101", unit: "bar", expected: "6.20", measured: "6.25", how: "média", tolerance: "± 0.10", verdict: "pass" }],
    writes: [],
    scans: [],
    trends: [],
    observations: "Sem pendências críticas. Acentuação: ação, válvula, Größe, µA, °C.",
    pending: "",
    signatures: [{ role: "executor", enabled: true, name: "Fulano", function: "Técnico", company: "Exemplo", date: "10/10/2026" }],
    csvAttached: true,
    ...over,
  });

  it("renders, embeds integrity metadata and attaches the CSV; verification round-trips", async () => {
    const { bytes, rows } = sampleCsv();
    const hash = await sha256Hex(bytes);
    const integrity = { hash, rows };
    const pdf = await renderToBuffer(createElement(ReportDocument, { data: data({ integrity }) }) as never);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const final = await finalizePdf(new Uint8Array(pdf), integrity, bytes, "sessao.csv");
    expect(await readIntegrity(final)).toEqual(integrity);
    expect(await attachmentNames(final)).toEqual(["sessao.csv"]);

    const ok = await verifyReport(final, bytes);
    expect(ok).toMatchObject({ csvMatches: true, signed: false, signatureValid: undefined });
    const tampered = new TextEncoder().encode(new TextDecoder().decode(bytes).replace("6.2,", "6.9,"));
    expect((await verifyReport(final, tampered)).csvMatches).toBe(false);
  }, 30_000);

  it("renders in English and German", async () => {
    for (const lang of ["en", "de"] as const) {
      const pdf = await renderToBuffer(createElement(ReportDocument, { data: data({ lang }) }) as never);
      expect(pdf.length).toBeGreaterThan(1000);
    }
  }, 30_000);
});
