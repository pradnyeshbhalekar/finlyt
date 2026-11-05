// Lets the launch splash land its logo exactly on the header logo: the header reports where it
// sits on screen, and stays hidden while the splash plays so the swap doesn't flicker.
import { useSyncExternalStore } from "react";

export type Rect = { x: number; y: number; width: number; height: number };

type State = { playing: boolean; target: Rect | null };

let state: State = { playing: true, target: null };
// The header logo measures itself on request: measuring on first layout can come back empty
// while its screen is still being attached, so the splash asks again just before it flies.
let measurer: (() => void) | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const splashStore = {
  /** The header logo's on-screen box (window coordinates). */
  setTarget(target: Rect) {
    set({ target });
  },
  get target(): Rect | null {
    return state.target;
  },
  setMeasurer(fn: (() => void) | null) {
    measurer = fn;
  },
  /** Ask the header logo to (re)measure; it answers through setTarget. */
  requestMeasure() {
    measurer?.();
  },
  /** The splash has landed (or was skipped): show the real header logo. */
  finish() {
    if (state.playing) set({ playing: false });
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useSplashPlaying(): boolean {
  return useSyncExternalStore(splashStore.subscribe, () => state.playing);
}
