// Finlyt's mark and wordmark, drawn from the "Finlyt logo" design canvas.
// The coin is the app's agent: it changes mood with what the app is doing.
import { useEffect, useRef, type ComponentRef } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Ellipse, G, Path, Rect } from "react-native-svg";

import { useLivelyMood } from "@/lib/lively";
import { EASE, sample, TAP_BOUNCE, TAP_BOUNCE_MS, taps } from "@/lib/motion";
import { splashStore, useSplashPlaying } from "@/lib/splash-store";
import { BRAND, BRAND_EDGE, INK, TINT, useTheme, WHITE } from "@/lib/theme";

const colors = { primary: BRAND, primaryEdge: BRAND_EDGE, tint: TINT, ink: INK, white: WHITE };

export type Mood = "default" | "happy" | "thinking" | "sleepy";

// Rolls the coin -10° and centres it in a 100×100 box.
const COIN_TRANSFORM = "translate(-1.48 -1.74) rotate(-10 50 52)";

function Eyes({ mood, color }: { mood: Mood; color: string }) {
  if (mood === "happy" || mood === "sleepy") {
    // Happy eyes arch up (^ ^), sleepy ones droop (u u).
    const [left, right] =
      mood === "happy"
        ? ["M36.4 53.4Q39.8 45.4 43.2 53.4", "M50.8 53.4Q54.2 45.4 57.6 53.4"]
        : ["M36.4 51.8Q39.8 56.6 43.2 51.8", "M50.8 51.8Q54.2 56.6 57.6 51.8"];
    return (
      <>
        <Path d={left} stroke={color} strokeWidth={3.4} strokeLinecap="round" fill="none" />
        <Path d={right} stroke={color} strokeWidth={3.4} strokeLinecap="round" fill="none" />
      </>
    );
  }
  // Thinking: eyes glance up and to the side.
  const [lx, rx, cy, ry] = mood === "thinking" ? [43.1, 56.1, 47.4, 7.2] : [40.5, 53.5, 51, 7.6];
  return (
    <>
      <Ellipse cx={lx} cy={cy} rx={5} ry={ry} fill={color} />
      <Ellipse cx={rx} cy={cy} rx={5} ry={ry} fill={color} />
    </>
  );
}

function CoinShape({
  face,
  rim,
  ring,
  eyes,
  mood,
}: {
  face: string;
  rim: string;
  ring: string;
  eyes: string;
  mood: Mood;
}) {
  return (
    <G transform={COIN_TRANSFORM}>
      <Path d="M47 21H56A26 31 0 0 1 56 83H47Z" fill={rim} />
      <Ellipse cx={47} cy={52} rx={26} ry={31} fill={face} />
      <Ellipse cx={47} cy={52} rx={20} ry={25} fill="none" stroke={ring} strokeWidth={3} />
      <Eyes mood={mood} color={eyes} />
    </G>
  );
}

/**
 * The coin agent.
 * - `badge`: the app icon, a white coin on a brand-blue rounded square.
 * - `bare`: just the coin. Brand blue with white eyes on light screens, white with blue eyes on dark.
 */
export function Coin({
  size = 64,
  mood = "default",
  variant = "badge",
}: {
  size?: number;
  mood?: Mood;
  variant?: "badge" | "bare";
}) {
  const { isDark: dark } = useTheme();
  const face = useLivelyMood(mood); // normal, then a smile, over and over
  if (variant === "badge") {
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden>
        <Rect width={100} height={100} rx={24} fill={colors.primary} />
        <CoinShape face={colors.white} rim={colors.tint} ring={colors.tint} eyes={colors.primary} mood={face} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="18 18 64 64" accessibilityElementsHidden>
      {dark ? (
        <CoinShape face={colors.white} rim={colors.tint} ring={colors.tint} eyes={colors.primary} mood={face} />
      ) : (
        <CoinShape face={colors.primary} rim={colors.primaryEdge} ring={colors.tint} eyes={colors.white} mood={face} />
      )}
    </Svg>
  );
}

// "finlyt" set in the canvas's display face, outlined. The i's dot is drawn separately so it
// can take the brand colour.
const WORDMARK =
  "M29.44 -40.22H21.18V-42.39C21.18 -45.44 22.32 -46.62 25.44 -46.62H29.44V-56.75H22.13C12.57 -56.75 8.04 -52.86 8.04 -44.67V-40.22H0.72V-30.09H8.04V0H21.18V-30.09H29.44ZM34.62 0H47.72V-40.22H34.62ZM66.64 -21.86C66.64 -27.35 69.3 -29.9 73.45 -29.9C77.6 -29.9 80 -27.31 80 -22.55V0H93.11V-25.29C93.11 -35.19 88 -41.09 79.28 -41.09C73.22 -41.09 69.15 -38.31 66.48 -33.71V-40.22H53.53V0H66.64ZM112.02 -56.75H98.92V0H112.02ZM119.09 15.92H127.89C134.63 15.92 138.47 12.95 141.22 5.67L158.55 -40.22H144.99L138.93 -21.71C138.06 -18.93 137.22 -16.11 136.46 -13.29C135.66 -16.11 134.86 -18.93 133.98 -21.71L128.04 -40.22H114.33L129.79 -0.08L129.11 1.75C128.15 4.68 127.39 5.75 124.65 5.75H119.09ZM186.22 -40.22H177.96V-51.19H164.82V-40.22H157.96V-30.09H164.82V-11.31C164.82 -3.5 169.16 0 178.79 0H186.22V-10.13H181.69C178.75 -10.13 177.96 -10.93 177.96 -13.52V-30.09H186.22Z";
const I_DOT =
  "M41.13 -44.14C45.36 -44.14 48.37 -46.92 48.37 -50.77C48.37 -54.62 45.36 -57.36 41.13 -57.36C36.94 -57.36 33.93 -54.62 33.93 -50.77C33.93 -46.92 36.94 -44.14 41.13 -44.14Z";

/** The bare coin + "finlyt", for headers. Blue coin and ink type on Light; white on Dark and Ink. */
export function Wordmark({ height = 28 }: { height?: number }) {
  const { isDark: dark } = useTheme();
  return (
    <Svg
      width={(height * 269) / 76}
      height={height}
      viewBox="18 12 269 76"
      accessibilityRole="image"
      accessibilityLabel="Finlyt"
    >
      {dark ? (
        <CoinShape face={colors.white} rim={colors.tint} ring={colors.tint} eyes={colors.primary} mood="default" />
      ) : (
        <CoinShape face={colors.primary} rim={colors.primaryEdge} ring={colors.tint} eyes={colors.white} mood="default" />
      )}
      <G transform="translate(99 70.11)">
        <Path d={WORDMARK} fill={dark ? colors.white : colors.ink} />
        <Path d={I_DOT} fill={dark ? colors.white : colors.primary} />
      </G>
    </Svg>
  );
}

// ── The logo as finlyt.onrender.com draws it ────────────────────────────────
// The coin's frame is 64×76 units (viewBox 18 12 64 76) and the wordmark's 205×76 including the gap
// after the coin (viewBox -17 -58.11 205 76), so the full logo is always 269:76. The header and the
// launch splash draw exactly these shapes, which is what lets the splash land on the header.

export const COIN_VIEWBOX = { x: 18, y: 12, w: 64, h: 76 };
export const WORD_VIEWBOX = { x: -17, y: -58.11, w: 205, h: 76 };

/** One shape per letter (the i's dot travels with the i), with each letter's own bounding box. */
export const LETTERS: { d: string; dot?: string; box: { x: number; y: number; w: number; h: number } }[] = [
  {
    d: "M29.44 -40.22H21.18V-42.39C21.18 -45.44 22.32 -46.62 25.44 -46.62H29.44V-56.75H22.13C12.57 -56.75 8.04 -52.86 8.04 -44.67V-40.22H0.72V-30.09H8.04V0H21.18V-30.09H29.44Z",
    box: { x: 0.72, y: -56.75, w: 28.72, h: 56.75 },
  },
  {
    d: "M34.62 0H47.72V-40.22H34.62Z",
    dot: "M41.13 -44.14C45.36 -44.14 48.37 -46.92 48.37 -50.77C48.37 -54.62 45.36 -57.36 41.13 -57.36C36.94 -57.36 33.93 -54.62 33.93 -50.77C33.93 -46.92 36.94 -44.14 41.13 -44.14Z",
    box: { x: 33.93, y: -57.36, w: 14.44, h: 57.36 },
  },
  {
    d: "M66.64 -21.86C66.64 -27.35 69.3 -29.9 73.45 -29.9C77.6 -29.9 80 -27.31 80 -22.55V0H93.11V-25.29C93.11 -35.19 88 -41.09 79.28 -41.09C73.22 -41.09 69.15 -38.31 66.48 -33.71V-40.22H53.53V0H66.64Z",
    box: { x: 53.53, y: -41.09, w: 39.58, h: 41.09 },
  },
  { d: "M112.02 -56.75H98.92V0H112.02Z", box: { x: 98.92, y: -56.75, w: 13.1, h: 56.75 } },
  {
    d: "M119.09 15.92H127.89C134.63 15.92 138.47 12.95 141.22 5.67L158.55 -40.22H144.99L138.93 -21.71C138.06 -18.93 137.22 -16.11 136.46 -13.29C135.66 -16.11 134.86 -18.93 133.98 -21.71L128.04 -40.22H114.33L129.79 -0.08L129.11 1.75C128.15 4.68 127.39 5.75 124.65 5.75H119.09Z",
    box: { x: 114.33, y: -40.22, w: 44.22, h: 56.14 },
  },
  {
    d: "M186.22 -40.22H177.96V-51.19H164.82V-40.22H157.96V-30.09H164.82V-11.31C164.82 -3.5 169.16 0 178.79 0H186.22V-10.13H181.69C178.75 -10.13 177.96 -10.93 177.96 -13.52V-30.09H186.22Z",
    box: { x: 157.96, y: -51.19, w: 28.26, h: 51.19 },
  },
];

/** Blue coin, white eyes and ink type on Light; white coin, blue eyes and white type on Ink/Dark. */
export function logoColors(dark: boolean) {
  return dark
    ? { face: WHITE, rim: TINT, ring: TINT, eyes: BRAND, text: WHITE, dot: WHITE }
    : { face: BRAND, rim: BRAND_EDGE, ring: TINT, eyes: WHITE, text: INK, dot: BRAND };
}

/** The coin without its eyes (the splash animates the eyes separately). */
export function CoinBody({ height, dark }: { height: number; dark: boolean }) {
  const c = logoColors(dark);
  return (
    <Svg width={(height * 64) / 76} height={height} viewBox="18 12 64 76">
      <G transform={COIN_TRANSFORM}>
        <Path d="M47 21H56A26 31 0 0 1 56 83H47Z" fill={c.rim} />
        <Ellipse cx={47} cy={52} rx={26} ry={31} fill={c.face} />
        <Ellipse cx={47} cy={52} rx={20} ry={25} fill="none" stroke={c.ring} strokeWidth={3} />
      </G>
    </Svg>
  );
}

/** Just the eyes, in the coin's frame, so they can blink on their own. */
export function CoinEyes({ height, dark, mood = "default" }: { height: number; dark: boolean; mood?: Mood }) {
  return (
    <Svg width={(height * 64) / 76} height={height} viewBox="18 12 64 76">
      <G transform={COIN_TRANSFORM}>
        <Eyes mood={mood} color={logoColors(dark).eyes} />
      </G>
    </Svg>
  );
}

export function WordmarkSvg({ height, dark }: { height: number; dark: boolean }) {
  const c = logoColors(dark);
  return (
    <Svg width={(height * 205) / 76} height={height} viewBox="-17 -58.11 205 76">
      {LETTERS.map((l, i) => (
        <G key={i}>
          <Path d={l.d} fill={c.text} />
          {l.dot ? <Path d={l.dot} fill={c.dot} /> : null}
        </G>
      ))}
    </Svg>
  );
}

/**
 * The header logo on every tab and on sign-in. At rest the coin is always alive: its normal face,
 * then a smile with a little hop, over and over. It also reacts: a bigger bounce and smile when
 * something is logged (happy), and it glances up and bobs while Gemini reads (thinking).
 * With `splashTarget`, it reports its position for the launch splash to land on, and stays hidden
 * until the splash's copy has landed exactly on top of it.
 */
export function HeaderLogo({
  height = 30,
  mood = "default",
  splashTarget = false,
}: {
  height?: number;
  mood?: Mood;
  splashTarget?: boolean;
}) {
  const { isDark: dark } = useTheme();
  const face = useLivelyMood(mood);
  const splashPlaying = useSplashPlaying();
  const box = useRef<ComponentRef<typeof View>>(null);
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);
  const lift = useSharedValue(0);

  useEffect(() => {
    if (mood === "happy") {
      scale.set(withSequence(withSpring(1.25, { damping: 6, stiffness: 260 }), withSpring(1, { damping: 9 })));
      rotate.set(
        withSequence(
          withTiming(-14, { duration: 120 }),
          withTiming(10, { duration: 140 }),
          withTiming(-5, { duration: 120 }),
          withTiming(0, { duration: 140 }),
        ),
      );
      lift.set(withTiming(0, { duration: 150 }));
    } else if (mood === "thinking") {
      lift.set(
        withRepeat(
          withSequence(
            withTiming(-2.5, { duration: 450, easing: Easing.inOut(Easing.quad) }),
            withTiming(0, { duration: 450, easing: Easing.inOut(Easing.quad) }),
          ),
          -1,
        ),
      );
      scale.set(withTiming(1, { duration: 150 }));
      rotate.set(withTiming(0, { duration: 150 }));
    } else {
      lift.set(withTiming(0, { duration: 200 }));
      scale.set(withTiming(1, { duration: 200 }));
      rotate.set(withTiming(0, { duration: 200 }));
    }
  }, [mood, scale, rotate, lift]);

  const coinStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.get() }, { scale: scale.get() }, { rotate: `${rotate.get()}deg` }],
  }));

  // Any tap in the app makes the coin bounce, like the header logo on finlyt.onrender.com.
  // It's its own layer, so it can overlap a mood animation without cancelling it.
  const reduceMotion = useReducedMotion();

  // The resting smile comes with a small hop and tilt.
  const idleSmile = mood === "default" && face === "happy";
  useEffect(() => {
    if (!idleSmile || reduceMotion) return;
    scale.set(withSequence(withSpring(1.1, { damping: 7, stiffness: 240 }), withSpring(1, { damping: 10 })));
    rotate.set(
      withSequence(
        withTiming(-7, { duration: 140 }),
        withTiming(5, { duration: 160 }),
        withTiming(0, { duration: 160 }),
      ),
    );
  }, [idleSmile, reduceMotion, scale, rotate]);

  const bounce = useSharedValue(1); // progress 0..1; 1 = still
  useEffect(() => {
    if (reduceMotion) return;
    return taps.subscribe(() => {
      bounce.set(
        withSequence(
          withTiming(0, { duration: 0 }),
          withTiming(1, { duration: TAP_BOUNCE_MS, easing: Easing.linear }),
        ),
      );
    });
  }, [bounce, reduceMotion]);
  const bounceStyle = useAnimatedStyle(() => {
    const p = bounce.get();
    const [ty, sx, sy, rot] = p >= 1 ? [0, 1, 1, 0] : sample(TAP_BOUNCE, EASE.out(p));
    return {
      transform: [{ translateY: (ty / 100) * height }, { scaleX: sx }, { scaleY: sy }, { rotate: `${rot}deg` }],
    };
  });

  function report() {
    if (!splashTarget || !box.current) return;
    // New-architecture views can answer synchronously; measureInWindow is the fallback.
    const node = box.current as unknown as {
      getBoundingClientRect?: () => { x: number; y: number; width: number; height: number };
    };
    const rect = node.getBoundingClientRect?.();
    if (rect && rect.width > 0) {
      splashStore.setTarget({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      return;
    }
    box.current.measureInWindow((x, y, width, h) => {
      if (width > 0) splashStore.setTarget({ x, y, width, height: h });
    });
  }

  // Let the splash ask for a fresh measurement right before it flies here.
  useEffect(() => {
    if (!splashTarget) return;
    splashStore.setMeasurer(report);
    return () => splashStore.setMeasurer(null);
  });

  return (
    <View
      ref={box}
      collapsable={false}
      onLayout={report}
      style={{ flexDirection: "row", opacity: splashTarget && splashPlaying ? 0 : 1 }}
      accessibilityRole="image"
      accessibilityLabel="Finlyt"
    >
      <Animated.View style={[{ transformOrigin: "50% 100%" }, bounceStyle]}>
        <Animated.View style={[{ transformOrigin: "50% 100%" }, coinStyle]}>
          <CoinBody height={height} dark={dark} />
          <View style={{ position: "absolute", left: 0, top: 0 }}>
            <CoinEyes height={height} dark={dark} mood={face} />
          </View>
        </Animated.View>
      </Animated.View>
      <WordmarkSvg height={height} dark={dark} />
    </View>
  );
}

/** App icon + "finlyt". Ink wordmark with a blue dot on light screens, all white on dark. */
export function Logo({ height = 48 }: { height?: number }) {
  const { isDark: dark } = useTheme();
  const text = dark ? colors.white : colors.ink;
  return (
    <Svg
      width={(height * 307.5) / 100}
      height={height}
      viewBox="0 0 307.5 100"
      accessibilityRole="image"
      accessibilityLabel="Finlyt"
    >
      <Rect width={100} height={100} rx={24} fill={colors.primary} />
      <CoinShape face={colors.white} rim={colors.tint} ring={colors.tint} eyes={colors.primary} mood="default" />
      <G transform="translate(121.28 70.11)">
        <Path d={WORDMARK} fill={text} />
        <Path d={I_DOT} fill={dark ? colors.white : colors.primary} />
      </G>
    </Svg>
  );
}
