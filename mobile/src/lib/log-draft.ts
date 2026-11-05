// What's being logged: the typed text and voice note on the Log tab, Gemini's proposal for the
// Review screen, and the result of saving it. Kept outside React so both screens share it and a
// save can clear the Log tab.
import { useSyncExternalStore } from "react";

import type { Proposal } from "./types";

export type VoiceNote = { uri: string; ms: number };

type State = {
  text: string;
  note: VoiceNote | null;
  proposal: Proposal | null;
  /** Set after a successful save, shown on the Log tab until the next edit. */
  saved: string | null;
};

let state: State = { text: "", note: null, proposal: null, saved: null };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export const logDraft = {
  setText(text: string) {
    set({ text, saved: null });
  },
  setNote(note: VoiceNote | null) {
    set({ note, saved: null });
  },
  review(proposal: Proposal) {
    set({ proposal });
  },
  /** The proposal was saved: start a fresh log. */
  finish(message: string) {
    set({ text: "", note: null, proposal: null, saved: message });
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
