import { STORAGE_KEY } from "./config";
import { cloneState, createDefaultState, normalizeState } from "./state";
import type { SaveData } from "./types";

export function createStorage(storage: Storage | null = null) {
  let backend = storage;
  if (!backend) {
    try {
      backend = window.localStorage;
    } catch (error) {
      backend = null;
    }
  }
  return {
    load(now = Date.now()) {
      let rawText = null;
      if (!backend) {
        return {
          state: createDefaultState(now),
          issue: "storage-unavailable",
          protectedRaw: false,
          rawText: null
        };
      }
      try {
        rawText = backend.getItem(STORAGE_KEY);
      } catch (error) {
        return {
          state: createDefaultState(now),
          issue: "storage-unavailable",
          protectedRaw: false,
          rawText: null
        };
      }

      if (!rawText) {
        return { state: createDefaultState(now), issue: null, protectedRaw: false, rawText: null };
      }

      let raw;
      try {
        raw = JSON.parse(rawText);
      } catch (error) {
        return {
          state: createDefaultState(now),
          issue: "corrupt",
          protectedRaw: true,
          rawText
        };
      }

      const normalized = normalizeState(raw, now);
      return Object.assign({}, normalized, { rawText });
    },

    save(state: SaveData, now = Date.now()) {
      const snapshot = cloneState(state);
      snapshot.lastSeen = now;
      if (!backend) {
        return { ok: false, error: new Error("storage unavailable"), snapshot };
      }
      try {
        backend.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        return { ok: true, snapshot };
      } catch (error) {
        return { ok: false, error, snapshot };
      }
    },

    reset() {
      if (!backend) {
        return { ok: false, error: new Error("storage unavailable") };
      }
      try {
        backend.removeItem(STORAGE_KEY);
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    }
  };
}
