import {
  EXCEPTION,
  FC,
  decodeRequest,
  encodeException,
  encodeResponse,
  encodeValue,
  registerCount,
  type ByteOrder,
  type DataType,
  type ExceptionCode,
  type ModbusRequest,
  type ModbusResponse,
  type Table,
} from "@modfield/protocol";

export type Generator =
  | { kind: "fixed"; value: number }
  | { kind: "ramp"; min: number; max: number; periodMs: number }
  | { kind: "sine"; offset: number; amplitude: number; periodMs: number }
  | { kind: "random"; min: number; max: number }
  | { kind: "counter"; step: number; intervalMs: number; max?: number };

export interface SimPoint {
  table: Table;
  address: number;
  /** Ignored for coils and discrete inputs, which are 0/1. */
  type?: DataType;
  order?: ByteOrder;
  generator: Generator;
  /** Fixed text for STRING points; the generator is ignored. */
  text?: string;
  /** Display name, used by the demo UI. */
  name?: string;
  unit?: string;
  /** How the demo profile scales the raw value (what a vendor manual would say). */
  scale?: { rawMin: number; rawMax: number; engMin: number; engMax: number };
  decimals?: number;
}

export interface SimSlaveConfig {
  unitId: number;
  name: string;
  points: SimPoint[];
  /** Read Device Identification objects (43/14). Omit to answer ILLEGAL FUNCTION. */
  deviceId?: Record<number, string>;
}

export function generate(g: Generator, tMs: number, rand: () => number = Math.random): number {
  switch (g.kind) {
    case "fixed":
      return g.value;
    case "ramp":
      return g.min + ((tMs % g.periodMs) / g.periodMs) * (g.max - g.min);
    case "sine":
      return g.offset + g.amplitude * Math.sin((2 * Math.PI * tMs) / g.periodMs);
    case "random":
      return g.min + rand() * (g.max - g.min);
    case "counter": {
      const n = Math.floor(tMs / g.intervalMs) * g.step;
      return g.max === undefined ? n : n % (g.max + 1);
    }
  }
}

const isInt = (t: DataType) => t !== "FLOAT32" && t !== "FLOAT64" && t !== "STRING";

/**
 * Register-level slave. Only addresses covered by a point exist; anything
 * else answers ILLEGAL DATA ADDRESS, like most real devices. A write replaces
 * the point's generator with the written registers.
 */
export class SimSlave {
  private readonly regs: Record<Table, Map<number, number>> = {
    coil: new Map(),
    discrete: new Map(),
    holding: new Map(),
    input: new Map(),
  };
  private readonly owner: Record<Table, Map<number, SimPoint>> = {
    coil: new Map(),
    discrete: new Map(),
    holding: new Map(),
    input: new Map(),
  };

  /** Points written by a master: they keep the written registers instead of generating. */
  private readonly frozen = new Set<SimPoint>();
  /** Generators run on time since power-up, like a real device's counters. */
  private readonly t0: number;

  constructor(
    readonly config: SimSlaveConfig,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.t0 = now();
    for (const p of config.points) {
      const n = p.table === "coil" || p.table === "discrete" ? 1 : registerCount(p.type ?? "UINT16", p.text?.length);
      for (let i = 0; i < n; i++) {
        this.owner[p.table].set(p.address + i, p);
        this.regs[p.table].set(p.address + i, 0);
      }
    }
  }

  get unitId(): number {
    return this.config.unitId;
  }

  private refresh(table: Table, address: number, quantity: number): void {
    const seen = new Set<SimPoint>();
    for (let a = address; a < address + quantity; a++) {
      const p = this.owner[table].get(a);
      if (!p || seen.has(p) || this.frozen.has(p)) continue;
      seen.add(p);
      const type = p.type ?? "UINT16";
      if (type === "STRING") {
        const text = p.text ?? "";
        encodeValue(text, type, p.order, text.length).forEach((r, i) => this.regs[table].set(p.address + i, r));
        continue;
      }
      const v = generate(p.generator, this.now() - this.t0);
      if (table === "coil" || table === "discrete") {
        this.regs[table].set(p.address, v >= 0.5 ? 1 : 0);
        continue;
      }
      const value = isInt(type) ? Math.round(v) : v;
      encodeValue(clampInt(value, type), type, p.order).forEach((r, i) => this.regs[table].set(p.address + i, r));
    }
  }

  private covered(table: Table, address: number, quantity: number): boolean {
    for (let a = address; a < address + quantity; a++) if (!this.regs[table].has(a)) return false;
    return true;
  }

  private freeze(table: Table, address: number, quantity: number): void {
    for (let a = address; a < address + quantity; a++) {
      const p = this.owner[table].get(a);
      if (p && !this.frozen.has(p)) {
        // Materialize the current value so untouched registers of the point stay consistent.
        this.refresh(table, p.address, 1);
        this.frozen.add(p);
      }
    }
  }

  /** Handles one request PDU and returns the response PDU. */
  handle(pdu: Uint8Array): Uint8Array {
    let req: ModbusRequest;
    try {
      req = decodeRequest(pdu);
    } catch {
      return encodeException(pdu[0] ?? 0, pdu[0] && isKnown(pdu[0]) ? EXCEPTION.ILLEGAL_DATA_VALUE : EXCEPTION.ILLEGAL_FUNCTION);
    }
    const r = this.execute(req);
    return typeof r === "number" ? encodeException(req.fc, r) : encodeResponse(r);
  }

  private execute(req: ModbusRequest): ModbusResponse | ExceptionCode {
    const table = TABLE_OF[req.fc];
    switch (req.fc) {
      case FC.READ_COILS:
      case FC.READ_DISCRETE_INPUTS:
      case FC.READ_HOLDING_REGISTERS:
      case FC.READ_INPUT_REGISTERS: {
        if (!this.covered(table!, req.address, req.quantity)) return EXCEPTION.ILLEGAL_DATA_ADDRESS;
        this.refresh(table!, req.address, req.quantity);
        const values = Array.from({ length: req.quantity }, (_, i) => this.regs[table!].get(req.address + i)!);
        return req.fc === FC.READ_COILS || req.fc === FC.READ_DISCRETE_INPUTS
          ? { fc: req.fc, bits: values.map((v) => v === 1) }
          : { fc: req.fc, registers: values };
      }
      case FC.WRITE_SINGLE_COIL:
      case FC.WRITE_SINGLE_REGISTER: {
        if (!this.covered(table!, req.address, 1)) return EXCEPTION.ILLEGAL_DATA_ADDRESS;
        this.freeze(table!, req.address, 1);
        this.regs[table!].set(req.address, typeof req.value === "boolean" ? Number(req.value) : req.value);
        return req;
      }
      case FC.WRITE_MULTIPLE_COILS:
      case FC.WRITE_MULTIPLE_REGISTERS: {
        if (!this.covered(table!, req.address, req.values.length)) return EXCEPTION.ILLEGAL_DATA_ADDRESS;
        this.freeze(table!, req.address, req.values.length);
        req.values.forEach((v, i) => this.regs[table!].set(req.address + i, Number(v)));
        return { fc: req.fc, address: req.address, quantity: req.values.length };
      }
      case FC.ENCAPSULATED_INTERFACE: {
        const objects = this.config.deviceId;
        if (!objects) return EXCEPTION.ILLEGAL_FUNCTION;
        // Basic: 0..2, regular: up to 0x7F, extended: all; code 4 asks for one object.
        const maxId = { 1: 0x02, 2: 0x7f, 3: 0xff, 4: 0xff }[req.readCode];
        const ids = Object.keys(objects)
          .map(Number)
          .filter((id) => (req.readCode === 4 ? id === req.objectId : id >= req.objectId && id <= maxId));
        if (!ids.length) return EXCEPTION.ILLEGAL_DATA_ADDRESS;
        return {
          fc: req.fc,
          readCode: req.readCode,
          conformity: 0x01,
          moreFollows: false,
          nextObjectId: 0,
          objects: Object.fromEntries(ids.map((id) => [id, objects[id]!])),
        };
      }
    }
  }
}

const TABLE_OF: Partial<Record<number, Table>> = {
  [FC.READ_COILS]: "coil",
  [FC.READ_DISCRETE_INPUTS]: "discrete",
  [FC.READ_HOLDING_REGISTERS]: "holding",
  [FC.READ_INPUT_REGISTERS]: "input",
  [FC.WRITE_SINGLE_COIL]: "coil",
  [FC.WRITE_MULTIPLE_COILS]: "coil",
  [FC.WRITE_SINGLE_REGISTER]: "holding",
  [FC.WRITE_MULTIPLE_REGISTERS]: "holding",
};

function isKnown(fc: number): boolean {
  return fc in TABLE_OF || fc === FC.ENCAPSULATED_INTERFACE;
}

function clampInt(v: number, type: DataType): number {
  const range: Partial<Record<DataType, [number, number]>> = {
    INT16: [-0x8000, 0x7fff],
    UINT16: [0, 0xffff],
    INT32: [-0x80000000, 0x7fffffff],
    UINT32: [0, 0xffffffff],
  };
  const r = range[type];
  return r ? Math.min(r[1], Math.max(r[0], v)) : v;
}
