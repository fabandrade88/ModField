import { describe, expect, it } from "vitest";
import { FC, ModbusError, decodeResponse, encodeRequest } from "@modfield/protocol";
import { MockTransport, ModbusClient, SimSlave, SimulatedSerialPort, WebSerialTransport, demoSlaves, generate } from "../src";

const fast = { latencyMs: 1, chunkSize: 3 };

async function demo(line = fast) {
  const t = new MockTransport({ line });
  await t.open();
  return { t, client: new ModbusClient(t, { timeoutMs: 100 }) };
}

describe("generators", () => {
  it("ramp, sine, counter", () => {
    expect(generate({ kind: "ramp", min: 0, max: 10, periodMs: 1000 }, 500)).toBe(5);
    expect(generate({ kind: "sine", offset: 5, amplitude: 2, periodMs: 1000 }, 250)).toBeCloseTo(7);
    expect(generate({ kind: "counter", step: 2, intervalMs: 100 }, 350)).toBe(6);
    expect(generate({ kind: "counter", step: 2, intervalMs: 100, max: 9 }, 1000)).toBe(0); // 20 wraps to 0
    expect(generate({ kind: "random", min: 1, max: 3 }, 0, () => 0.5)).toBe(2);
  });
});

describe("SimSlave", () => {
  const slave = () => demoSlaves(() => 0)[0]!;
  const ask = (s: SimSlave, req: Parameters<typeof encodeRequest>[0]) => decodeResponse(req, s.handle(encodeRequest(req)));

  it("answers ILLEGAL DATA ADDRESS outside the map", () => {
    expect(() => ask(slave(), { fc: FC.READ_HOLDING_REGISTERS, address: 50, quantity: 1 })).toThrow(
      expect.objectContaining({ code: "MODBUS_EXCEPTION", exception: 2 }),
    );
  });

  it("keeps written values instead of the generator", () => {
    const s = slave();
    ask(s, { fc: FC.WRITE_SINGLE_REGISTER, address: 1, value: 3000 });
    expect(ask(s, { fc: FC.READ_HOLDING_REGISTERS, address: 0, quantity: 2 }).registers).toEqual([1, 3000]);
  });

  it("filters device id objects by access level", () => {
    const s = slave();
    const basic = ask(s, { fc: FC.ENCAPSULATED_INTERFACE, readCode: 1, objectId: 0 });
    expect(Object.keys(basic.objects)).toEqual(["0", "1", "2"]);
    const one = ask(s, { fc: FC.ENCAPSULATED_INTERFACE, readCode: 4, objectId: 5 });
    expect(one.objects).toEqual({ 5: "INV-7.5" });
  });
});

describe("MockTransport over the simulated line", () => {
  it("reads typed values from the demo bench", async () => {
    const { t, client } = await demo();
    expect(await client.read(1, "holding", 1, "UINT16")).toBe(4500);
    const pressure = (await client.read(2, "holding", 0, "FLOAT32", "CDAB")) as number;
    expect(pressure).toBeGreaterThan(5.7);
    expect(pressure).toBeLessThan(6.7);
    expect(await client.read(2, "holding", 10, "STRING", "ABCD", 16)).toBe("PT-101 RECALQUE");
    expect(await client.readBits(1, "coil", 0, 1)).toEqual([true]);
    await t.close();
  });

  it("writes FLOAT32 with function 16 and reads it back", async () => {
    const { t, client } = await demo();
    const seen: number[] = [];
    t.on("traffic", (f) => f.dir === "tx" && seen.push(f.bytes[1]!));
    await client.writeValue(3, 100, 42.5, "FLOAT32");
    expect(await client.read(3, "holding", 100, "FLOAT32")).toBe(42.5);
    expect(seen).toEqual([0x10, 0x03]);
    await t.close();
  });

  it("reads device identification", async () => {
    const { t, client } = await demo();
    expect(await client.readDeviceId(1)).toEqual({ 0: "ModField", 1: "DEMO-INV", 2: "1.4.2", 4: "Inversor demo", 5: "INV-7.5" });
    await expect(client.readDeviceId(3)).rejects.toMatchObject({ code: "MODBUS_EXCEPTION", exception: 1 });
    await t.close();
  });

  it("times out on a unit that does not exist and counts it", async () => {
    const { t, client } = await demo();
    const frames: string[] = [];
    t.on("traffic", (f) => frames.push(`${f.dir}:${f.error ?? "ok"}`));
    await expect(client.readRegisters(9, "holding", 0, 1)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(t.stats).toMatchObject({ requests: 1, timeouts: 1 });
    expect(frames).toEqual(["tx:ok", "rx:TIMEOUT"]);
    // The bus is usable again right after.
    expect(await client.read(1, "holding", 0, "UINT16")).toBe(1);
    await t.close();
  });

  it("reports CRC_ERROR when a data byte is corrupted", async () => {
    // rand() = 0.99 always corrupts and picks the last byte (CRC high byte).
    const { t, client } = await demo({ ...fast, corruptRate: 1, rand: () => 0.99 } as typeof fast);
    await expect(client.readRegisters(1, "holding", 0, 1)).rejects.toMatchObject({ code: "CRC_ERROR" });
    expect(t.stats.crcErrors).toBe(1);
    await t.close();
  });

  it("fails cleanly on a noisy line", async () => {
    const { t, client } = await demo({ ...fast, corruptRate: 1 } as typeof fast);
    await expect(client.readRegisters(1, "holding", 0, 1)).rejects.toBeInstanceOf(ModbusError);
    // A flipped bit in the byte count changes the expected length, so that case ends as a timeout.
    expect(t.stats.crcErrors + t.stats.timeouts + t.stats.errors).toBe(1);
    await t.close();
  });

  it("serializes concurrent requests", async () => {
    const { t, client } = await demo();
    const results = await Promise.all([
      client.read(1, "holding", 0, "UINT16"),
      client.read(1, "holding", 1, "UINT16"),
      client.read(2, "holding", 2, "UINT16"),
    ]);
    expect(results.slice(0, 2)).toEqual([1, 4500]);
    expect(t.stats.requests).toBe(3);
    await t.close();
  });

  it("goes to error state with PORT_DISCONNECTED when unplugged", async () => {
    const line = new SimulatedSerialPort(demoSlaves(), { latencyMs: 50 });
    const t = new WebSerialTransport(line);
    await t.open();
    const pending = t.request(1, { fc: FC.READ_HOLDING_REGISTERS, address: 0, quantity: 1 }, { timeoutMs: 1000 });
    line.unplug();
    await expect(pending).rejects.toMatchObject({ code: "PORT_DISCONNECTED" });
    expect(t.state).toBe("error");
  });

  it("maps a busy port to PORT_BUSY", async () => {
    const line = new SimulatedSerialPort(demoSlaves());
    await line.open({ baudRate: 9600 });
    const t = new WebSerialTransport(line);
    await expect(t.open()).rejects.toMatchObject({ code: "PORT_BUSY" });
  });
});
