"use client";
import { DEMO_LINE, DEMO_SLAVES, DEFAULT_SERIAL } from "@modfield/transport";
import { db, newId, type Equipment, type Profile, type TagRow } from "./db";

export const DEMO_PROFILE_ID = "demo";

export function blankProfile(name: string): Profile {
  return {
    id: newId(),
    name,
    serial: { ...DEFAULT_SERIAL },
    tcp: { host: "192.168.0.10", port: 502 },
    timeoutMs: 1000,
    forceMultipleWrite: false,
    updatedAt: Date.now(),
  };
}

/** First run: a demo profile with the bench's tags and equipment, so every module has something to show. */
export async function ensureSeed(): Promise<void> {
  if ((await db.profiles.count()) > 0) return;
  const profile: Profile = {
    ...blankProfile("Demonstração"),
    id: DEMO_PROFILE_ID,
    serial: { ...DEMO_LINE, interRequestDelayMs: 2 },
  };
  const tags: TagRow[] = [];
  const equipment: Equipment[] = [];
  for (const s of DEMO_SLAVES) {
    equipment.push({
      id: newId(),
      profileId: profile.id,
      unitId: s.unitId,
      manufacturer: "",
      model: "",
      serialNumber: "",
      tag: s.name,
      firmware: "",
    });
    for (const p of s.points) {
      tags.push({
        id: newId(),
        profileId: profile.id,
        sort: tags.length,
        name: p.name ?? `${s.unitId}:${p.table}:${p.address}`,
        unitId: s.unitId,
        table: p.table,
        offset: p.address,
        type: p.type ?? "UINT16",
        order: p.order ?? "ABCD",
        stringLength: p.text?.length,
        unit: p.unit,
        scale: p.scale,
        decimals: p.decimals,
      });
    }
  }
  await db.transaction("rw", db.profiles, db.tags, db.equipment, async () => {
    await db.profiles.add(profile);
    await db.tags.bulkAdd(tags);
    await db.equipment.bulkAdd(equipment);
  });
}
