// Finlyt's mark and wordmark, drawn from the "Finlyt logo" design canvas.
// The coin is the app's agent: it changes mood with what the app is doing.
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Ellipse, G, Path, Rect } from "react-native-svg";

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
  if (variant === "badge") {
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden>
        <Rect width={100} height={100} rx={24} fill={colors.primary} />
        <CoinShape face={colors.white} rim={colors.tint} ring={colors.tint} eyes={colors.primary} mood={mood} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="18 18 64 64" accessibilityElementsHidden>
      {dark ? (
        <CoinShape face={colors.white} rim={colors.tint} ring={colors.tint} eyes={colors.primary} mood={mood} />
      ) : (
        <CoinShape face={colors.primary} rim={colors.primaryEdge} ring={colors.tint} eyes={colors.white} mood={mood} />
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

/**
 * Home's header logo: the bare coin + "finlyt", with the coin alive. It bounces and smiles
 * (happy) when something is logged, glances up while Gemini reads (thinking), and dozes late at
 * night (sleepy). Same proportions as the canvas's logo: the coin and the type are cut from the
 * one 269×76 artwork at x = 99.
 */
export function HeaderLogo({ height = 30, mood = "default" }: { height?: number; mood?: Mood }) {
  const { isDark: dark } = useTheme();
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
      // A gentle bob while waiting.
      lift.set(withRepeat(withSequence(withTiming(-2.5, { duration: 450, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 450, easing: Easing.inOut(Easing.quad) })), -1));
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

  return (
    <View className="flex-row" accessibilityRole="image" accessibilityLabel="Finlyt">
      <Animated.View style={coinStyle}>
        <Svg width={(height * 81) / 76} height={height} viewBox="18 12 81 76">
          {dark ? (
            <CoinShape face={colors.white} rim={colors.tint} ring={colors.tint} eyes={colors.primary} mood={mood} />
          ) : (
            <CoinShape face={colors.primary} rim={colors.primaryEdge} ring={colors.tint} eyes={colors.white} mood={mood} />
          )}
        </Svg>
      </Animated.View>
      <Svg width={(height * 188) / 76} height={height} viewBox="99 12 188 76">
        <G transform="translate(99 70.11)">
          <Path d={WORDMARK} fill={dark ? colors.white : colors.ink} />
          <Path d={I_DOT} fill={dark ? colors.white : colors.primary} />
        </G>
      </Svg>
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
