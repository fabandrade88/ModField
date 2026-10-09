import {
  EXCEPTION,
  FC,
  ModbusError,
  decodeValue,
  encodeValue,
  registerCount,
  type ByteOrder,
  type DataType,
  type Table,
} from "@modfield/protocol";
import type { Transport } from "./types";

export interface ClientOptions {
  timeoutMs: number;
}

/**
 * Convenience layer over a transport: one method per Modbus function and
 * typed value helpers. Holds no state of its own besides the timeout.
 */
export class ModbusClient {
  constructor(
    readonly transport: Transport,
    public options: ClientOptions = { timeoutMs: 1000 },
  ) {}

  private get opts() {
    return { timeoutMs: this.options.timeoutMs };
  }

  async readBits(unitId: number, table: "coil" | "discrete", address: number, quantity: number): Promise<boolean[]> {
    const fc = table === "coil" ? FC.READ_COILS : FC.READ_DISCRETE_INPUTS;
    return (await this.transport.request(unitId, { fc, address, quantity }, this.opts)).bits;
  }

  async readRegisters(unitId: number, table: "holding" | "input", address: number, quantity: number): Promise<number[]> {
    const fc = table === "holding" ? FC.READ_HOLDING_REGISTERS : FC.READ_INPUT_REGISTERS;
    return (await this.transport.request(unitId, { fc, address, quantity }, this.opts)).registers;
  }

  async read(unitId: number, table: Table, address: number, type: DataType, order: ByteOrder = "ABCD", stringLength = 0) {
    if (table === "coil" || table === "discrete") return Number((await this.readBits(unitId, table, address, 1))[0]);
    const regs = await this.readRegisters(unitId, table, address, registerCount(type, stringLength));
    return decodeValue(regs, type, order);
  }

  writeCoil(unitId: number, address: number, value: boolean, confirmToken?: string) {
    return this.transport.request(unitId, { fc: FC.WRITE_SINGLE_COIL, address, value }, { ...this.opts, confirmToken });
  }

  writeRegister(unitId: number, address: number, value: number, confirmToken?: string) {
    return this.transport.request(unitId, { fc: FC.WRITE_SINGLE_REGISTER, address, value }, { ...this.opts, confirmToken });
  }

  writeRegisters(unitId: number, address: number, values: number[], confirmToken?: string) {
    return this.transport.request(unitId, { fc: FC.WRITE_MULTIPLE_REGISTERS, address, values }, { ...this.opts, confirmToken });
  }

  writeCoils(unitId: number, address: number, values: boolean[], confirmToken?: string) {
    return this.transport.request(unitId, { fc: FC.WRITE_MULTIPLE_COILS, address, values }, { ...this.opts, confirmToken });
  }

  /** 32/64-bit values always go out with function 16; 16-bit ones with 06 unless `forceMultiple`. */
  writeValue(
    unitId: number,
    address: number,
    value: number | string,
    type: DataType,
    order: ByteOrder = "ABCD",
    opts: { forceMultiple?: boolean; stringLength?: number; confirmToken?: string } = {},
  ) {
    const regs = encodeValue(value, type, order, opts.stringLength);
    return regs.length === 1 && !opts.forceMultiple
      ? this.writeRegister(unitId, address, regs[0]!, opts.confirmToken)
      : this.writeRegisters(unitId, address, regs, opts.confirmToken);
  }

  /** Reads the regular identification objects, falling back to basic if the device refuses. */
  async readDeviceId(unitId: number): Promise<Record<number, string>> {
    try {
      return await this.readDeviceIdObjects(unitId, 2);
    } catch (e) {
      if (e instanceof ModbusError && e.code === "MODBUS_EXCEPTION" && e.exception === EXCEPTION.ILLEGAL_DATA_VALUE) {
        return this.readDeviceIdObjects(unitId, 1);
      }
      throw e;
    }
  }

  private async readDeviceIdObjects(unitId: number, readCode: 1 | 2): Promise<Record<number, string>> {
    const objects: Record<number, string> = {};
    let objectId = 0;
    for (let page = 0; page < 8; page++) {
      const res = await this.transport.request(unitId, { fc: FC.ENCAPSULATED_INTERFACE, readCode, objectId }, this.opts);
      Object.assign(objects, res.objects);
      if (!res.moreFollows) break;
      objectId = res.nextObjectId;
    }
    return objects;
  }
}
