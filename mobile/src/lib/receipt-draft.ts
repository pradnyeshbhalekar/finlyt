// A scanned receipt being read, kept outside the screen so it survives leaving it: the pages
// (JPEGs in the app's cache, from modules/doc-scanner) and Finlyt's reading of them. Reading
// takes a few seconds, so if you go elsewhere a notification brings you back (lib/reply-alert).
// Cleared once it's saved or thrown away, or when someone else signs in.
import { File } from "expo-file-system";
import { useSyncExternalStore } from "react";

import { DocScanner } from "../../modules/doc-scanner";
import { api } from "./api";
import { alertIfAway } from "./reply-alert";
import type { Proposal } from "./types";

type State = {
  pages: string[];
  reading: boolean;
  proposal: Proposal | null;
  error: string | null;
};

const EMPTY: State = { pages: [], reading: false, proposal: null, error: null };
const URL = "/receipt";

let state: State = EMPTY;
let ownerId: number | null = null;
/** Bumped on every reset, so a reading of a receipt that was thrown away is dropped. */
let generation = 0;
let watcher: (() => boolean) | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function upload(pages: string[]): Promise<Proposal> {
  const form = new FormData();
  pages.forEach((uri, i) => {
    const page = new File(uri);
    // Expo's fetch takes any object with name, type and bytes() as a file part (see useProposeLog).
    const part = { name: `page-${i + 1}.jpg`, type: "image/jpeg", bytes: async () => new Uint8Array(await page.arrayBuffer()) };
    form.append("image", part as unknown as Blob);
  });
  return api<Proposal>("/api/log/receipt", { method: "POST", form });
}

export const receiptDraft = {
  /** Called when the screen opens: another person's receipt is never shown. */
  enter(userId: number | null) {
    if (userId !== ownerId) receiptDraft.reset();
    ownerId = userId;
  },
  reset() {
    generation += 1;
    set(EMPTY);
  },
  /** Send the scanned pages to be read. Nothing is saved. */
  async read(pages: string[]) {
    generation += 1;
    const mine = generation;
    set({ pages, reading: true, proposal: null, error: null });
    try {
      const proposal = await upload(pages);
      if (mine !== generation) return;
      set({ reading: false, proposal });
      const e = proposal.expenses[0];
      alertIfAway(
        watcher?.() ?? false,
        e ? "Your receipt is ready to check" : "Finlyt couldn't read the receipt",
        e ? `${e.description}. Tap to check it and say who owes you.` : (proposal.questions[0] ?? "Try scanning it again."),
        URL,
      );
    } catch (e) {
      if (mine !== generation) return;
      set({ reading: false, error: (e as Error).message });
      alertIfAway(watcher?.() ?? false, "Finlyt couldn't read the receipt", (e as Error).message, URL);
    }
  },
  /**
   * Opens Google's document scanner; once pages come back, starts reading them. `started` is
   * false if the scanner was closed; `error` says why it couldn't open.
   */
  async scan(): Promise<{ started: boolean; error?: string }> {
    if (!DocScanner) {
      return { started: false, error: "Scanning receipts needs the newest Finlyt. Update the app, then try again." };
    }
    try {
      const result = await DocScanner.scan(3);
      if (!result?.pages.length) return { started: false };
      void receiptDraft.read(result.pages);
      return { started: true };
    } catch (e) {
      console.warn("[receipt] scanner failed", e);
      return {
        started: false,
        error: "The scanner didn't open. It needs Google Play services; try again in a minute, or add it by hand.",
      };
    }
  },
  retry() {
    if (state.pages.length) void receiptDraft.read(state.pages);
  },
  watch(isWatching: (() => boolean) | null) {
    watcher = isWatching;
  },
  get(): State {
    return state;
  },
};

export function useReceiptDraft(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
