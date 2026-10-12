import type { ChainParams } from "../dsp/types.ts";
import { parseChainParams } from "./session-snapshot.ts";

export const MAX_PROCESSING_SNAPSHOTS = 8;
export type ProcessingSnapshot = { id: string; name: string; params: ChainParams };
export type ProcessingBank = { entries: ProcessingSnapshot[]; aId: string | null; bId: string | null };
export const emptyProcessingBank = (): ProcessingBank => ({ entries: [], aId: null, bId: null });

function validName(bank: ProcessingBank, value: string, exceptId?: string) {
  const name = value.trim();
  if (!name || name.length > 80) throw new Error("Use a snapshot name between 1 and 80 characters.");
  if (bank.entries.some(s => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase()))
    throw new Error("A snapshot with that name already exists.");
  return name;
}
export function getProcessingSnapshot(bank: ProcessingBank, id: string): ProcessingSnapshot {
  const entry = bank.entries.find(s => s.id === id);
  if (!entry) throw new Error("That processing snapshot no longer exists.");
  return { ...entry, params: parseChainParams(entry.params) };
}
export function captureProcessingSnapshot(bank: ProcessingBank, name: string, params: ChainParams, id: string): ProcessingBank {
  if (bank.entries.length >= MAX_PROCESSING_SNAPSHOTS) throw new Error("Eight snapshots are already stored. Delete one before capturing another.");
  if (!id || id.length > 64 || bank.entries.some(s => s.id === id)) throw new Error("Snapshot ID is invalid or already in use.");
  const entry = { id, name: validName(bank, name), params: parseChainParams(params) };
  return { ...bank, entries: [...bank.entries, entry],
    aId: bank.aId ?? id, bId: bank.aId && !bank.bId ? id : bank.bId };
}
export function renameProcessingSnapshot(bank: ProcessingBank, id: string, value: string): ProcessingBank {
  getProcessingSnapshot(bank, id);
  const name = validName(bank, value, id);
  return { ...bank, entries: bank.entries.map(s => s.id === id ? { ...s, name } : s) };
}
export function deleteProcessingSnapshot(bank: ProcessingBank, id: string): ProcessingBank {
  getProcessingSnapshot(bank, id);
  return { entries: bank.entries.filter(s => s.id !== id), aId: bank.aId === id ? null : bank.aId,
    bId: bank.bId === id ? null : bank.bId };
}
export function assignProcessingSlot(bank: ProcessingBank, slot: "a" | "b", id: string | null): ProcessingBank {
  if (id) getProcessingSnapshot(bank, id);
  if (id && (slot === "a" ? bank.bId : bank.aId) === id) throw new Error("Assign different snapshots to A and B.");
  return { ...bank, [slot === "a" ? "aId" : "bId"]: id };
}
