// The import in progress, kept outside the screen so it survives leaving it: the reply you
// pasted, which chat it's from, and Finlyt's reading of it with your ticks. Reading a long chat
// can take a minute, so it carries on if you go elsewhere and can notify you when it's done
// (lib/reply-alert). Cleared once the import is saved, or when someone else signs in.
import { useSyncExternalStore } from "react";

import { api } from "./api";
import { alertIfAway } from "./reply-alert";
import type { ImportPreview, ImportSource } from "./types";

type State = {
  source: ImportSource;
  text: string;
  preview: ImportPreview | null;
  /** Which entries are ticked, by their index in the preview. */
  include: Record<number, boolean>;
  takePlan: boolean;
  reading: boolean;
  readError: string | null;
};

const EMPTY: State = { source: "claude", text: "", preview: null, include: {}, takePlan: true, reading: false, readError: null };
const URL = "/import";

let state: State = EMPTY;
let ownerId: number | null = null;
/** Bumped on every reset, so a reading of a reply that was thrown away is dropped. */
let generation = 0;
let watcher: (() => boolean) | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export const importDraft = {
  set,
  /** Called when the screen opens: another person's draft is never shown. */
  enter(userId: number | null) {
    if (userId !== ownerId) importDraft.reset();
    ownerId = userId;
  },
  reset() {
    generation += 1;
    set(EMPTY);
  },
  /** Ask the server to read the pasted reply. Nothing is saved. */
  async read() {
    if (state.reading) return;
    const mine = generation;
    const { text, source } = state;
    set({ reading: true, readError: null });
    try {
      const data = await api<ImportPreview>("/api/import/preview", { method: "POST", body: { text, source } });
      if (mine !== generation) return;
      set({
        reading: false,
        preview: data,
        include: Object.fromEntries(data.entries.map((e) => [e.index, e.include])),
        takePlan: !!data.plan,
      });
      const found = data.entries.length;
      alertIfAway(
        watcher?.() ?? false,
        "Your import is ready to check",
        `Finlyt read the reply: ${found} ${found === 1 ? "entry" : "entries"}. Tap to look through them.`,
        URL,
      );
    } catch (e) {
      if (mine !== generation) return;
      set({ reading: false, readError: (e as Error).message });
      alertIfAway(watcher?.() ?? false, "Finlyt couldn't read the reply", (e as Error).message, URL);
    }
  },
  watch(isWatching: (() => boolean) | null) {
    watcher = isWatching;
  },
};

export function useImportDraft(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
