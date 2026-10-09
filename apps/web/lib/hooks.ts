"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { useUi } from "@/store/ui";
import { db, type Equipment, type Profile, type TagRow } from "./db";

export function useProfiles(): Profile[] {
  return useLiveQuery(() => db.profiles.orderBy("name").toArray(), [], []);
}

export function useProfile(): Profile | undefined {
  const id = useUi((s) => s.profileId);
  return useLiveQuery(() => db.profiles.get(id), [id]);
}

export function useTags(): TagRow[] {
  const id = useUi((s) => s.profileId);
  return useLiveQuery(() => db.tags.where("profileId").equals(id).sortBy("sort"), [id], []);
}

export function useEquipment(): Equipment[] {
  const id = useUi((s) => s.profileId);
  return useLiveQuery(() => db.equipment.where("profileId").equals(id).sortBy("unitId"), [id], []);
}

export function updateProfile(id: string, patch: Partial<Profile>): void {
  void db.profiles.update(id, { ...patch, updatedAt: Date.now() });
}
