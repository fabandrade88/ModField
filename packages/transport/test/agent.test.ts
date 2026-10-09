import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FC } from "@modfield/protocol";
import { AgentAuthError, AgentClient, AgentTransport, ModbusClient, discoverAgent, type AgentCredentials, type AgentEndpoint } from "../src";

/**
 * Integration against the real Go agent. Needs Go (mise.toml pins it); skipped
 * when `go` is not on PATH.
 */
const ORIGIN = "http://vitest.local";
const CODE = "135790";
const AGENT_DIR = join(import.meta.dirname, "../../../agent");

function hasGo(): boolean {
  try {
    execFileSync("go", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const withOrigin = (url: string) => new WebSocket(url, { headers: { Origin: ORIGIN } } as unknown as string[]);
const fetchWithOrigin = (url: string, init?: RequestInit) => fetch(url, { ...init, headers: { Origin: ORIGIN } });

/** A free port, so a stale agent from an interrupted run cannot collide. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

describe.skipIf(!hasGo())("agent integration", () => {
  let PORT: number;
  let proc: ChildProcess;
  let dir: string;
  let endpoint: AgentEndpoint;
  let cred: AgentCredentials;
  let simAddr: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "modfield-agent-"));
    PORT = await freePort();
    const bin = join(dir, "modfield-agent");
    execFileSync("go", ["build", "-tags", "notray", "-o", bin, "./cmd/modfield-agent"], { cwd: AGENT_DIR, stdio: "inherit" });
    proc = spawn(bin, ["--headless", "--dev", "--no-browser", "--no-update", "--port", String(PORT), "--data-dir", join(dir, "data"), "--allow-origin", ORIGIN, "--test-pairing-code", CODE], {
      stdio: "ignore",
    });
    for (let i = 0; i < 100 && !endpoint; i++) {
      endpoint = (await discoverAgent({ ports: [PORT], fetch: fetchWithOrigin, timeoutMs: 200 }))!;
      if (!endpoint) await new Promise((r) => setTimeout(r, 100));
    }
  }, 120_000);

  afterAll(() => {
    proc?.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  it("is discovered with a compatible protocol", () => {
    expect(endpoint.hello.protocol).toEqual({ major: 1, minor: 0 });
    expect(endpoint.compatibility).toBe("ok");
    expect(endpoint.hello.features).toContain("tcp");
  });

  it("pairs with the code shown by the agent", async () => {
    const c = new AgentClient(endpoint, withOrigin);
    await c.connect();
    const { requestId } = await c.beginPairing("vitest");
    await expect(c.completePairing(requestId, "000000")).rejects.toMatchObject({ code: "NOT_PAIRED" });
    cred = await c.completePairing(requestId, CODE);
    expect(cred.publicKey).toBe(endpoint.hello.publicKey);
    c.close();
  });

  it("authenticates and refuses an agent with another key", async () => {
    const c = new AgentClient(endpoint, withOrigin);
    await c.connect();
    await expect(c.call("serial.list")).rejects.toMatchObject({ code: "NOT_PAIRED" });
    await c.authenticate(cred, ORIGIN);
    expect(Array.isArray(await c.call("serial.list"))).toBe(true);
    c.close();

    const impostor = new AgentClient({ ...endpoint, hello: { ...endpoint.hello, publicKey: "x".repeat(43) } }, withOrigin);
    await impostor.connect();
    await expect(impostor.authenticate(cred, ORIGIN)).rejects.toBeInstanceOf(AgentAuthError);
    impostor.close();
  });

  it("reads and writes the agent's TCP simulator through AgentTransport", async () => {
    const c = new AgentClient(endpoint, withOrigin);
    await c.connect();
    await c.authenticate(cred, ORIGIN);
    const sim = await c.call<{ addr: string }>("sim.start", { transport: "tcp", listen: "127.0.0.1:0" });
    simAddr = sim.addr;
    const [host, port] = simAddr.split(":");
    const t = new AgentTransport(c, { kind: "tcp", host: host!, tcpPort: Number(port) });
    const frames: string[] = [];
    t.on("traffic", (f) => frames.push(`${f.dir}:${f.framing}`));
    await t.open();
    expect(t.label).toMatch(/^Agente · TCP 127\.0\.0\.1:\d+$/);
    const client = new ModbusClient(t, { timeoutMs: 500 });

    expect(await client.read(1, "holding", 1, "UINT16")).toBe(4500);
    expect(await client.read(2, "holding", 10, "STRING", "ABCD", 15)).toBe("PT-101 RECALQUE");
    expect(await client.readBits(1, "coil", 0, 1)).toEqual([true]);
    await expect(client.read(1, "holding", 50, "UINT16")).rejects.toMatchObject({ code: "MODBUS_EXCEPTION", exception: 2 });
    await expect(client.read(9, "holding", 0, "UINT16")).rejects.toMatchObject({ code: "TIMEOUT" });

    // Writes need the confirmation token.
    await expect(t.request(1, { fc: FC.WRITE_SINGLE_REGISTER, address: 1, value: 1 }, { timeoutMs: 500 })).rejects.toMatchObject({ code: "CONFIRM_REQUIRED" });
    await client.writeValue(3, 100, 42.5, "FLOAT32", "ABCD", { confirmToken: crypto.randomUUID() });
    expect(await client.read(3, "holding", 100, "FLOAT32")).toBe(42.5);
    await client.writeCoil(1, 0, false, crypto.randomUUID());
    expect(await client.readBits(1, "coil", 0, 1)).toEqual([false]);
    expect(await client.readDeviceId(1)).toMatchObject({ 0: "ModField", 5: "INV-7.5" });

    expect(t.stats).toMatchObject({ timeouts: 1, exceptions: 1 });
    expect(frames).toContain("tx:tcp");
    await t.close();
    c.close();
  });
});
