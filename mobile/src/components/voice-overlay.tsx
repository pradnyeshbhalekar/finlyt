// The full-screen listening view. Tapping the mic opens it over everything (tab bar included):
// a soft gradient in the theme's colours, an orb that swells with your voice, and the words in
// big type as they're heard. When you stop, the words shrink and fly down into the box at the
// bottom while the screen fades away, and Home sends them (the answer then slides in there).
import { Mic, Square, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, useWindowDimensions, View, type LayoutRectangle } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import { EASE } from "@/lib/motion";
import { BRAND, BRAND_EDGE, TINT, useTheme, WHITE } from "@/lib/theme";

import { Txt } from "./ui";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type VoicePhase = "listening" | "landing";
export type Box = { x: number; y: number; width: number; height: number };

const ORB = 132;
const LAND_MS = 560;

function clock(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VoiceOverlay({
  phase,
  heard,
  mode,
  level,
  elapsedMs,
  target,
  onStop,
  onCancel,
  onLanded,
}: {
  /** null when closed. */
  phase: VoicePhase | null;
  /** The words heard so far (speech), or the voice note's label (recording). */
  heard: string;
  mode: "speech" | "recording";
  /** Loudness, 0..1. */
  level: SharedValue<number>;
  elapsedMs: number;
  /** Where the box is on screen, for the words to fly into. */
  target: Box | null;
  onStop: () => void;
  onCancel: () => void;
  onLanded: () => void;
}) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const visible = phase !== null;

  // 0 → 1 as it opens; 1 → 0 as the words land.
  const shown = useSharedValue(0);
  const land = useSharedValue(0);
  const breathe = useSharedValue(0);
  const [words, setWords] = useState<LayoutRectangle | null>(null);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const shrink = useSharedValue(0.5);

  useEffect(() => {
    if (!visible) return;
    land.set(0);
    shown.set(0);
    shown.set(withTiming(1, { duration: reduced ? 0 : 240, easing: Easing.out(Easing.cubic) }));
    breathe.set(reduced
      ? 0
      : withRepeat(withSequence(withTiming(1, { duration: 1100 }), withTiming(0, { duration: 1100 })), -1));
  }, [visible, reduced, shown, land, breathe]);

  useEffect(() => {
    if (phase !== "landing") return;
    // From the middle of the words to the middle of the box, shrinking to the box's text size.
    if (words && target) {
      dx.set(target.x + target.width / 2 - (words.x + words.width / 2));
      dy.set(target.y + target.height / 2 - (words.y + words.height / 2));
      shrink.set(16 / 30);
    } else {
      dx.set(0);
      dy.set(height * 0.25);
      shrink.set(0.5);
    }
    land.set(withTiming(1, { duration: reduced ? 120 : LAND_MS, easing: EASE.fly }, (done) => {
      if (done) scheduleOnRN(onLanded);
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const backdrop = useAnimatedStyle(() => ({
    opacity: shown.get() * (1 - Math.min(land.get() * 1.35, 1)),
  }));
  const chrome = useAnimatedStyle(() => ({
    opacity: shown.get() * (1 - Math.min(land.get() * 2.5, 1)),
    transform: [{ translateY: (1 - shown.get()) * 24 }],
  }));
  const wordsStyle = useAnimatedStyle(() => {
    const p = land.get();
    return {
      opacity: shown.get() * (1 - Math.max(0, (p - 0.75) / 0.25)),
      transform: [
        { translateX: dx.get() * p },
        { translateY: dy.get() * p + (1 - shown.get()) * 16 },
        { scale: 1 + (shrink.get() - 1) * p },
      ],
    };
  });
  const orbStyle = useAnimatedStyle(() => {
    const voice = level.get();
    return {
      opacity: shown.get() * (1 - Math.min(land.get() * 2, 1)),
      transform: [{ scale: (0.85 + 0.15 * shown.get()) * (1 + voice * 0.12 + breathe.get() * 0.03) * (1 - land.get() * 0.6) }],
    };
  });
  const haloOuter = useAnimatedProps(() => ({
    r: ORB * 0.5 + 18 + level.get() * 46 + breathe.get() * 6,
    opacity: 0.14 + level.get() * 0.12,
  }));
  const haloInner = useAnimatedProps(() => ({
    r: ORB * 0.5 + 8 + level.get() * 24 + breathe.get() * 3,
    opacity: 0.22 + level.get() * 0.18,
  }));

  // The theme's own ground fading into its soft accent, with the brand glowing behind the orb.
  const glow = isDark ? 0.5 : 0.24;
  const orbTop = insets.top + height * 0.16;
  const placeholder = mode === "recording" ? "Recording a voice note" : "Say what you spent";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={StyleSheet.absoluteFill} pointerEvents={phase === "landing" ? "none" : "auto"}>
        <Animated.View style={[StyleSheet.absoluteFill, backdrop]}>
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.bg} />
                <Stop offset="0.55" stopColor={colors.bg} />
                <Stop offset="1" stopColor={colors.accentSoft} />
              </LinearGradient>
              <RadialGradient id="glow" cx={width / 2} cy={orbTop + ORB / 2} r={width * 0.75} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={BRAND} stopOpacity={glow} />
                <Stop offset="0.6" stopColor={BRAND} stopOpacity={glow * 0.25} />
                <Stop offset="1" stopColor={BRAND} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x={0} y={0} width={width} height={height} fill="url(#ground)" />
            <Rect x={0} y={0} width={width} height={height} fill="url(#glow)" />
          </Svg>
        </Animated.View>

        <Animated.View
          style={[{ paddingTop: insets.top + 8 }, chrome]}
          className="flex-row items-center justify-between px-4"
        >
          <View className="flex-row items-center gap-2 pl-1">
            <View className="h-2 w-2 rounded-full" style={{ backgroundColor: mode === "recording" ? colors.danger : BRAND }} />
            <Txt weight="medium" tone="muted">
              {mode === "recording" ? `Recording · ${clock(elapsedMs)}` : "Listening"}
            </Txt>
          </View>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            hitSlop={8}
            className="h-11 w-11 items-center justify-center rounded-full active:bg-surface"
          >
            <X size={22} color={colors.muted} strokeWidth={1.75} />
          </Pressable>
        </Animated.View>

        <Animated.View
          style={[{ position: "absolute", top: orbTop - 40, left: width / 2 - ORB / 2 - 40, width: ORB + 80, height: ORB + 80 }, orbStyle]}
          pointerEvents="none"
        >
          <Svg width={ORB + 80} height={ORB + 80}>
            <Defs>
              <RadialGradient id="orb" cx="38%" cy="32%" r="75%">
                <Stop offset="0" stopColor={TINT} />
                <Stop offset="0.55" stopColor={BRAND} />
                <Stop offset="1" stopColor={BRAND_EDGE} />
              </RadialGradient>
            </Defs>
            <AnimatedCircle cx={ORB / 2 + 40} cy={ORB / 2 + 40} fill={BRAND} animatedProps={haloOuter} />
            <AnimatedCircle cx={ORB / 2 + 40} cy={ORB / 2 + 40} fill={BRAND} animatedProps={haloInner} />
            <Circle cx={ORB / 2 + 40} cy={ORB / 2 + 40} r={ORB / 2} fill="url(#orb)" />
          </Svg>
          <View style={StyleSheet.absoluteFill} className="items-center justify-center">
            <Mic size={40} color={WHITE} strokeWidth={1.75} />
          </View>
        </Animated.View>

        <View style={{ position: "absolute", top: orbTop + ORB + 40, left: 0, right: 0 }} className="px-7">
          <Animated.View
            style={wordsStyle}
            onLayout={(e) => {
              const { width: w, height: h, x, y } = e.nativeEvent.layout;
              // x already includes the parent's padding; the parent sits at the left edge.
              setWords({ x, y: y + orbTop + ORB + 40, width: w, height: h });
            }}
          >
            {heard ? (
              <Txt weight="semibold" className="text-center" style={{ fontSize: 30, lineHeight: 38, letterSpacing: -0.4 }}>
                {heard}
              </Txt>
            ) : (
              <>
                <Txt weight="semibold" tone="muted" className="text-center" style={{ fontSize: 30, lineHeight: 38, letterSpacing: -0.4 }}>
                  {placeholder}
                </Txt>
                <Txt tone="faint" className="mt-3 text-center text-base">
                  {mode === "recording" ? "Finlyt will read it when you stop." : "like “auto 120 cash, chai 40”"}
                </Txt>
              </>
            )}
          </Animated.View>
        </View>

        <Animated.View
          style={[{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 28 }, chrome]}
          className="items-center"
        >
          <Pressable
            onPress={onStop}
            accessibilityRole="button"
            accessibilityLabel={heard ? "Done, send it" : "Stop"}
            className="h-[76px] w-[76px] items-center justify-center rounded-full active:opacity-80"
            style={{ backgroundColor: BRAND }}
          >
            <Square size={26} color={WHITE} fill={WHITE} strokeWidth={1.75} />
          </Pressable>
          <Txt tone="muted" className="mt-3 text-sm">
            {heard ? "Tap when you're done" : "It stops by itself when you pause"}
          </Txt>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Loudness for the orb, smoothed. Call `set` with 0..1 as readings arrive. */
export function useVoiceLevel() {
  const level = useSharedValue(0);
  return {
    level,
    set(value: number) {
      level.set(withSpring(value, { damping: 18, stiffness: 160 }));
    },
    reset() {
      level.set(withTiming(0, { duration: 200 }));
    },
  };
}
