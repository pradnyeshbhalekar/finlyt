// The coin is always a little alive: at rest it shows its normal face for a few seconds, then
// smiles for a moment, again and again. One clock drives every coin on screen, so they smile
// together, and it only runs while some coin is showing.
import { useSyncExternalStore } from "react";

import type { Mood } from "@/components/brand";

const NORMAL_MS = 2600;
const SMILE_MS = 1500;

let smiling = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function tick() {
  smiling = !smiling;
  listeners.forEach((listener) => listener());
  timer = setTimeout(tick, smiling ? SMILE_MS : NORMAL_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) timer = setTimeout(tick, NORMAL_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearTimeout(timer);
      smiling = false;
    }
  };
}

const read = () => smiling;

/** True while the coins are in their smile. */
export function useSmiling(): boolean {
  return useSyncExternalStore(subscribe, read, read);
}

/** A resting coin ("default") smiles now and then; a coin in another mood keeps it. */
export function useLivelyMood(mood: Mood): Mood {
  const smile = useSmiling();
  return mood === "default" && smile ? "happy" : mood;
}
