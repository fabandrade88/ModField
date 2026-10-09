"use client";
import { tagWidth } from "@modfield/protocol";
import { db, newId, type TagRow } from "./db";

/** New tag right after the last one, same slave and table: the usual way maps are typed in. */
export async function addTag(profileId: string, tags: TagRow[]): Promise<string> {
  const last = tags[tags.length - 1];
  const id = newId();
  await db.tags.add({
    id,
    profileId,
    sort: (last?.sort ?? -1) + 1,
    name: `TAG-${tags.length + 1}`,
    unitId: last?.unitId ?? 1,
    table: last?.table ?? "holding",
    offset: last ? last.offset + tagWidth(last) : 0,
    type: last?.type ?? "UINT16",
    order: last?.order ?? "ABCD",
  });
  return id;
}
