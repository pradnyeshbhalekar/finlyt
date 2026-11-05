// Keyframe animation helpers shared by the launch splash and the header logo. They follow the
// Web Animations API that finlyt.onrender.com uses: one easing curve over the whole run, and
// straight lines between keyframes.
import { Easing } from "react-native-reanimated";

export type Frame = { o: number; v: number[] };

export const EASE = {
  linear: (x: number) => {
    "worklet";
    return x;
  },
  out: Easing.bezierFn(0, 0, 0.58, 1), // CSS ease-out
  inOut: Easing.bezierFn(0.42, 0, 0.58, 1), // CSS ease-in-out
  slide: Easing.bezierFn(0.5, 0, 0.2, 1),
  fly: Easing.bezierFn(0.65, 0, 0.25, 1),
};

/** Values at eased progress p (0..1), linear between keyframes. */
export function sample(frames: Frame[], p: number): number[] {
  "worklet";
  if (p <= frames[0].o) return frames[0].v;
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (p <= b.o) {
      const k = (p - a.o) / (b.o - a.o || 1);
      return a.v.map((x, j) => x + (b.v[j] - x) * k);
    }
  }
  return frames[frames.length - 1].v;
}

export function clamp01(x: number): number {
  "worklet";
  return Math.min(Math.max(x, 0), 1);
}

/**
 * The header logo's bounce when you tap something (the site's header does the same): squash,
 * big jump with a lean, small hop the other way, settle. translateY (% of height), scaleX,
 * scaleY, rotate (deg); 720 ms ease-out from the coin's bottom centre.
 */
export const TAP_BOUNCE: Frame[] = [
  { o: 0, v: [0, 1, 1, 0] },
  { o: 0.12, v: [4, 1.14, 0.86, 0] },
  { o: 0.34, v: [-30, 0.9, 1.12, -7] },
  { o: 0.54, v: [0, 1.12, 0.88, 0] },
  { o: 0.72, v: [-13, 0.96, 1.05, 6] },
  { o: 0.88, v: [0, 1.04, 0.96, 0] },
  { o: 1, v: [0, 1, 1, 0] },
];
export const TAP_BOUNCE_MS = 720;

// ── Taps anywhere in the app ────────────────────────────────────────────────
const tapListeners = new Set<() => void>();

export const taps = {
  emit() {
    tapListeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    tapListeners.add(listener);
    return () => {
      tapListeners.delete(listener);
    };
  },
};
