// The launch splash, ported from finlyt.onrender.com (Splash.jsx) with the same keyframes, delays,
// durations and easing curves. One clock (`t`, in ms) drives every layer, so a tap can make
// whatever is still running play 5× faster without cutting it off.
//
// Layers, as on the site: the whole logo (fly) > the coin's slide > pop > the coin itself (dance
// and happy hop, pivoting on its bottom centre) with the eyes on their own (blink), and each
// letter on its own (rises from its bottom centre). The logo then flies onto the header logo's
// measured box, the background fades, and the real header logo takes over.
import { useEffect, useRef, type ComponentRef } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import { clamp01, EASE, sample, type Frame } from "@/lib/motion";
import { splashStore } from "@/lib/splash-store";
import { useTheme } from "@/lib/theme";

import { CoinBody, CoinEyes, LETTERS, logoColors, WORD_VIEWBOX } from "./brand";

// ── Timeline (ms) ───────────────────────────────────────────────────────────
const DANCE_AT = 400;
const SLIDE_AT = 1450;
const LETTERS_AT = 1500;
const LETTER_GAP = 80;
const LETTER_LEN = 420;
const HOP_AT = LETTERS_AT + (LETTERS.length - 1) * LETTER_GAP + LETTER_LEN; // 2320
const FLY_AT = HOP_AT + 380; // 2700
const FLY_LEN = 650;
const LAND_AT = FLY_AT + FLY_LEN; // 3350
const END = LAND_AT + 150; // the copy fades off the real header logo

const linear = EASE.linear;

// ── Keyframes (offset, values), straight from the site ──────────────────────
/** Pop: scale, opacity. */
const POP: Frame[] = [
  { o: 0, v: [0, 0] },
  { o: 0.6, v: [1.15, 1] },
  { o: 0.8, v: [0.95, 1] },
  { o: 1, v: [1, 1] },
];
/** Dance: translateY (% of coin height), rotate (deg), scaleX, scaleY. */
const DANCE: Frame[] = [
  { o: 0, v: [0, 0, 1, 1] },
  { o: 0.14, v: [0, -12, 1.06, 0.94] },
  { o: 0.28, v: [-16, -4, 0.95, 1.06] },
  { o: 0.42, v: [0, 12, 1.06, 0.94] },
  { o: 0.56, v: [-16, 4, 0.95, 1.06] },
  { o: 0.7, v: [0, -10, 1.06, 0.94] },
  { o: 0.85, v: [-24, 0, 0.92, 1.1] },
  { o: 1, v: [0, 0, 1, 1] },
];
/** Blink: scaleY of the eyes. */
const BLINK: Frame[] = [
  { o: 0, v: [1] },
  { o: 0.32, v: [1] },
  { o: 0.37, v: [0.1] },
  { o: 0.42, v: [1] },
  { o: 1, v: [1] },
];
/** Each letter: opacity, translateY (% of the letter's height), scale. */
const LETTER: Frame[] = [
  { o: 0, v: [0, 50, 0.4] },
  { o: 0.6, v: [1, -15, 1.1] },
  { o: 1, v: [1, 0, 1] },
];
/** Happy hop: translateY (% of coin height), scaleX, scaleY. */
const HOP: Frame[] = [
  { o: 0, v: [0, 1, 1] },
  { o: 0.2, v: [4, 1.1, 0.9] },
  { o: 0.5, v: [-22, 0.94, 1.08] },
  { o: 0.8, v: [0, 1.06, 0.94] },
  { o: 1, v: [0, 1, 1] },
];

/** Raw progress of a track at time t: <0 before it starts, >1 after it ends. */
function progress(t: number, at: number, length: number): number {
  "worklet";
  return (t - at) / length;
}

function Letter({
  index,
  t,
  scale,
  dark,
}: {
  index: number;
  t: SharedValue<number>;
  scale: number;
  dark: boolean;
}) {
  const { d, dot, box } = LETTERS[index];
  const c = logoColors(dark);
  const w = box.w * scale;
  const h = box.h * scale;
  const style = useAnimatedStyle(() => {
    // fill: both — hidden before its turn, settled after.
    const p = EASE.out(clamp01(progress(t.get(), LETTERS_AT + index * LETTER_GAP, LETTER_LEN)));
    const [opacity, ty, s] = sample(LETTER, p);
    return { opacity, transform: [{ translateY: (ty / 100) * h }, { scale: s }] };
  });
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: (box.x - WORD_VIEWBOX.x) * scale,
          top: (box.y - WORD_VIEWBOX.y) * scale,
          width: w,
          height: h,
          transformOrigin: "50% 100%",
        },
        style,
      ]}
    >
      <Svg width={w} height={h} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}>
        <Path d={d} fill={c.text} />
        {dot ? <Path d={dot} fill={c.dot} /> : null}
      </Svg>
    </Animated.View>
  );
}

export function Splash({ onDone }: { onDone: () => void }) {
  const { width: screenW } = useWindowDimensions();
  const { colors, isDark: dark } = useTheme();
  const reduceMotion = useReducedMotion();

  // 3.5× a 24px header: 84px tall, capped at 18.7% of the screen width on phones.
  const H = Math.min(84, screenW * 0.187);
  const unit = H / 76;
  const coinW = 64 * unit;
  const wordW = 205 * unit;
  const logoW = coinW + wordW;
  const slideFrom = logoW / 2 - coinW / 2; // the coin starts at the logo's (screen's) centre

  const t = useSharedValue(0);
  const fly = useSharedValue({ ready: 0, dx: 0, dy: 0, s: 1 });
  const logoBox = useRef<ComponentRef<typeof View>>(null);
  const logoRect = useRef<{ x: number; y: number; width: number } | null>(null);
  const sped = useRef(false);

  // Where to land: the header logo's box relative to this logo's box (both in window coordinates).
  function aim() {
    const target = splashStore.target;
    const from = logoRect.current;
    if (!target || !from || from.width === 0) return;
    fly.set({ ready: 1, dx: target.x - from.x, dy: target.y - from.y, s: target.width / from.width });
  }

  function measure() {
    logoBox.current?.measureInWindow((x, y, width) => {
      logoRect.current = { x, y, width };
      aim();
    });
  }

  useEffect(() => splashStore.subscribe(aim));

  // JS-side cues on the same timeline: ask the header logo where it is (early, then again just
  // before the fly, when its screen is surely attached), and hand over when the copy lands.
  // `speed` is 1, or 5 after a tap; the cues are rescheduled to match.
  const cues = useRef<ReturnType<typeof setTimeout>[]>([]);
  function scheduleCues(now: number, speed: number) {
    cues.current.forEach(clearTimeout);
    const at = (ms: number, fn: () => void) => cues.current.push(setTimeout(fn, Math.max((ms - now) / speed, 0)));
    at(600, () => splashStore.requestMeasure());
    at(FLY_AT - 400, () => splashStore.requestMeasure());
    at(LAND_AT, () => splashStore.finish());
  }

  useEffect(() => {
    if (reduceMotion) {
      // Asked for less motion: no splash at all.
      splashStore.finish();
      onDone();
      return;
    }
    t.set(
      withTiming(END, { duration: END, easing: Easing.linear }, (finished) => {
        "worklet";
        if (finished) scheduleOnRN(onDone);
      }),
    );
    scheduleCues(0, 1);
    const pending = cues;
    return () => {
      pending.current.forEach(clearTimeout);
      splashStore.finish(); // never leave the header logo hidden
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A tap makes everything still running play 5× faster.
  function speedUp() {
    if (sped.current) return;
    sped.current = true;
    scheduleCues(t.get(), 5);
    const left = END - t.get();
    t.set(
      withTiming(END, { duration: Math.max(left / 5, 1), easing: Easing.linear }, (finished) => {
        "worklet";
        if (finished) scheduleOnRN(onDone);
      }),
    );
  }

  const bgStyle = useAnimatedStyle(() => ({
    opacity: 1 - EASE.out(clamp01(progress(t.get(), FLY_AT + 50, 600))),
  }));

  const flyStyle = useAnimatedStyle(() => {
    const now = t.get();
    const swapOut = 1 - clamp01(progress(now, LAND_AT, END - LAND_AT));
    const f = fly.get();
    if (!f.ready) {
      // No header logo to land on (e.g. onboarding): fade out instead.
      return { opacity: (1 - clamp01(progress(now, FLY_AT, 400))) * swapOut, transform: [] };
    }
    const p = EASE.fly(clamp01(progress(now, FLY_AT, FLY_LEN)));
    return {
      opacity: swapOut,
      transform: [{ translateX: f.dx * p }, { translateY: f.dy * p }, { scale: 1 + (f.s - 1) * p }],
    };
  });

  const slideStyle = useAnimatedStyle(() => {
    // fill: backwards — waits at the centre until it starts.
    const p = EASE.slide(clamp01(progress(t.get(), SLIDE_AT, 500)));
    return { transform: [{ translateX: slideFrom * (1 - p) }] };
  });

  const popStyle = useAnimatedStyle(() => {
    const [s, opacity] = sample(POP, EASE.out(clamp01(progress(t.get(), 0, 450))));
    return { opacity, transform: [{ scale: s }] };
  });

  const coinStyle = useAnimatedStyle(() => {
    const now = t.get();
    const dance = progress(now, DANCE_AT, 1000);
    if (dance >= 0 && dance <= 1) {
      const [ty, rot, sx, sy] = sample(DANCE, EASE.inOut(dance));
      return {
        transform: [{ translateY: (ty / 100) * H }, { rotate: `${rot}deg` }, { scaleX: sx }, { scaleY: sy }],
      };
    }
    const hop = progress(now, HOP_AT, 480);
    if (hop >= 0 && hop <= 1) {
      const [ty, sx, sy] = sample(HOP, EASE.out(hop));
      return { transform: [{ translateY: (ty / 100) * H }, { rotate: "0deg" }, { scaleX: sx }, { scaleY: sy }] };
    }
    return { transform: [{ translateY: 0 }, { rotate: "0deg" }, { scaleX: 1 }, { scaleY: 1 }] };
  });

  const blinkStyle = useAnimatedStyle(() => {
    const p = progress(t.get(), DANCE_AT, 1000);
    const [sy] = p >= 0 && p <= 1 ? sample(BLINK, linear(p)) : [1];
    return { transform: [{ scaleY: sy }] };
  });

  if (reduceMotion) return null;

  return (
    <Pressable
      onPress={speedUp}
      style={[StyleSheet.absoluteFill, { zIndex: 100 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }, bgStyle]} />
      <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]} pointerEvents="none">
        <Animated.View
          ref={logoBox}
          onLayout={measure}
          style={[{ flexDirection: "row", width: logoW, height: H, transformOrigin: "0% 0%" }, flyStyle]}
        >
          <Animated.View style={slideStyle}>
            <Animated.View style={popStyle}>
              <Animated.View style={[{ width: coinW, height: H, transformOrigin: "50% 100%" }, coinStyle]}>
                <CoinBody height={H} dark={dark} />
                {/* The eyes blink from their own centre (42.8%, 49.7% of the coin's frame). */}
                <Animated.View
                  style={[
                    { position: "absolute", left: 0, top: 0, width: coinW, height: H, transformOrigin: "42.8% 49.7%" },
                    blinkStyle,
                  ]}
                >
                  <CoinEyes height={H} dark={dark} />
                </Animated.View>
              </Animated.View>
            </Animated.View>
          </Animated.View>
          <View style={{ width: wordW, height: H }}>
            {LETTERS.map((_, i) => (
              <Letter key={i} index={i} t={t} scale={unit} dark={dark} />
            ))}
          </View>
        </Animated.View>
      </View>
    </Pressable>
  );
}
