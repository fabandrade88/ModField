import { WebSerialTransport, type SerialSettings } from "../webserial/transport";
import type { TransportKind } from "../types";
import { demoSlaves } from "./demo";
import { DEMO_LINE, SimulatedSerialPort, type SimulatedLineOptions } from "./serial-port";
import type { SimSlave } from "./slave";

/**
 * Demo mode and end-to-end tests: the real RTU transport on a simulated line.
 * No agent and no hardware needed.
 */
export class MockTransport extends WebSerialTransport {
  override readonly kind: TransportKind = "mock";
  readonly line: SimulatedSerialPort;

  constructor(opts: { slaves?: SimSlave[]; line?: SimulatedLineOptions; settings?: SerialSettings } = {}) {
    const line = new SimulatedSerialPort(opts.slaves ?? demoSlaves(), opts.line);
    super(line, opts.settings ?? { ...DEMO_LINE, interRequestDelayMs: 2 });
    this.line = line;
  }

  override get label(): string {
    return "Demonstração · 19200 8E1";
  }
}
