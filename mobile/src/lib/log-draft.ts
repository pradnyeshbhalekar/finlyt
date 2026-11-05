// What's being logged on Home: the composer's text and voice note, a proposal waiting for a
// quick check, and the last save (for Undo). Kept outside React so Home and the Review screen
// share it.
import { useSyncExternalStore } from "react";

import type { BankTxnItem, Proposal } from "./types";

export type VoiceNote = { uri: string; ms: number };
/** Gemini's reading of `input`, waiting to be checked. */
export type Pending = { proposal: Proposal; input: string };
export type Saved = {
  message: string;
  expenseIds: number[];
  input: string;
  questions: string[];
  /** Only plain expenses can be undone (deleting them); paybacks and txn marks can't yet. */
  undoable: boolean;
};

type State = {
  text: string;
  note: VoiceNote | null;
  pending: Pending | null;
  saved: Saved | null;
  /** A one-line reply from Gemini when nothing could be saved, e.g. what it couldn't work out. */
  notice: string | null;
  /** The bank payment (from SMS) the composer is asking about, if one is picked. */
  txn: BankTxnItem | null;
};

let state: State = { text: "", note: null, pending: null, saved: null, notice: null, txn: null };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export const logDraft = {
  setText(text: string) {
    set({ text, notice: null });
  },
  setNote(note: VoiceNote | null) {
    set({ note, notice: null });
  },
  notice(message: string | null) {
    set({ notice: message });
  },
  selectTxn(txn: BankTxnItem | null) {
    set({ txn, notice: null });
  },
  /** Gemini answered; show its entries for a check. The composer is cleared. */
  hold(pending: Pending) {
    set({ pending, text: "", note: null, saved: null, notice: null });
  },
  /** Throw the proposal away and put the words back in the composer to edit. */
  discard() {
    set({ text: state.pending?.input ?? state.text, pending: null });
  },
  saved(saved: Saved) {
    set({ saved, pending: null, text: "", note: null, notice: null, txn: null });
  },
  /** After Undo: bring the words back so they can be fixed and sent again. */
  undone() {
    set({ text: state.saved?.input ?? "", saved: null });
  },
  clearSaved() {
    set({ saved: null });
  },
  get(): State {
    return state;
  },
};

export function useLogDraft(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
