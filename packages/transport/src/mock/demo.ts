import { SimSlave, type SimSlaveConfig } from "./slave";

/**
 * The demo bench: an inverter, a pressure transmitter and a flow meter with
 * the quirks found in the field (FLOAT32 in CDAB, 4-20 mA in raw counts).
 */
export const DEMO_SLAVES: SimSlaveConfig[] = [
  {
    unitId: 1,
    name: "Inversor de frequência",
    deviceId: { 0: "ModField", 1: "DEMO-INV", 2: "1.4.2", 4: "Inversor demo", 5: "INV-7.5" },
    points: [
      { table: "holding", address: 0, type: "UINT16", generator: { kind: "fixed", value: 1 }, name: "Comando (0 parar, 1 partir)" },
      { table: "holding", address: 1, type: "UINT16", generator: { kind: "fixed", value: 4500 }, name: "Referência de frequência", unit: "0,01 Hz" },
      { table: "input", address: 0, type: "UINT16", generator: { kind: "sine", offset: 4500, amplitude: 30, periodMs: 20_000 }, name: "Frequência de saída", unit: "0,01 Hz" },
      { table: "input", address: 1, type: "UINT16", generator: { kind: "sine", offset: 112, amplitude: 6, periodMs: 7_000 }, name: "Corrente do motor", unit: "0,1 A" },
      { table: "input", address: 2, type: "INT16", generator: { kind: "sine", offset: 41, amplitude: 2, periodMs: 60_000 }, name: "Temperatura do dissipador", unit: "°C" },
      { table: "input", address: 3, type: "UINT32", generator: { kind: "counter", step: 1, intervalMs: 1000 }, name: "Horas de operação (s)", unit: "s" },
      { table: "coil", address: 0, generator: { kind: "fixed", value: 1 }, name: "Habilitado" },
      { table: "discrete", address: 0, generator: { kind: "fixed", value: 0 }, name: "Falha" },
    ],
  },
  {
    unitId: 2,
    name: "Transmissor de pressão",
    deviceId: { 0: "ModField", 1: "DEMO-PT", 2: "2.0.1" },
    points: [
      { table: "holding", address: 0, type: "FLOAT32", order: "CDAB", generator: { kind: "sine", offset: 6.2, amplitude: 0.4, periodMs: 30_000 }, name: "Pressão", unit: "bar" },
      { table: "holding", address: 2, type: "UINT16", generator: { kind: "ramp", min: 4000, max: 20000, periodMs: 60_000 }, name: "Loop 4–20 mA (µA)", unit: "µA" },
      { table: "holding", address: 10, type: "STRING", text: "PT-101 RECALQUE", generator: { kind: "fixed", value: 0 }, name: "Tag do instrumento" },
    ],
  },
  {
    unitId: 3,
    name: "Medidor de vazão",
    points: [
      { table: "holding", address: 100, type: "FLOAT32", generator: { kind: "random", min: 12.1, max: 12.9 }, name: "Vazão", unit: "m³/h" },
      { table: "holding", address: 102, type: "FLOAT64", generator: { kind: "counter", step: 0.0035, intervalMs: 1000 }, name: "Totalizador", unit: "m³" },
    ],
  },
];

export function demoSlaves(now?: () => number): SimSlave[] {
  return DEMO_SLAVES.map((c) => new SimSlave(structuredClone(c), now));
}
