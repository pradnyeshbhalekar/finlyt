// The full-screen listening view. Tapping the mic opens it over everything (tab bar included):
// a soft glow in the theme's colours that drifts slowly, an orb with rings rippling out of it, a
// waveform that moves with your voice, and the words in big type as they're heard. Done (or a
// pause) ends it: the words shrink and fly down into the box at the bottom while the screen fades
// away, and Home sends them (the answer then slides in there). Cancel puts the box back.
//
// JavaScript only (react-native-svg and Reanimated), so changes ship as over-the-air updates.
import { Check, Mic, X } from "lucide-react-native";
import { useEffect, useRef, type ComponentRef } from "react";
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
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

const ORB = 112;
const RING_ROOM = 70; // space around the orb for the ripples
const BARS = 29;
const LAND_MS = 560;
const LOOP_MS = 4200; // one turn of the shared clock: ripples, waveform wobble, drifting glow
const TAU = Math.PI * 2;

function clock(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** One bar of the waveform: taller in the middle, louder voice = taller, always wobbling a bit. */
function Bar({ i, level, turn, color }: { i: number; level: SharedValue<number>; turn: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    const t = turn.get();
    // Whole-number speeds keep the wobble seamless when the clock wraps around.
    const wobble = 0.5 + 0.5 * Math.sin(t * (2 + (i % 4)) + i * 1.7);
    const middle = 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
    const loud = 0.12 + level.get() * 0.88;
    return { height: 4 + (8 + 36 * middle) * loud * (0.35 + 0.65 * wobble) };
  });
  return <Animated.View style={[{ width: 3, borderRadius: 2, backgroundColor: color }, style]} />;
}

/** A ring spreading out of the orb and fading; three of them, a third of a turn apart. */
function Ripple({ i, level, turn, center }: { i: number; level: SharedValue<number>; turn: SharedValue<number>; center: number }) {
  const props = useAnimatedProps(() => {
    const p = (turn.get() / TAU + i / 3) % 1;
    return {
      r: ORB / 2 + 4 + p * (34 + level.get() * 30),
      opacity: (1 - p) * (0.18 + level.get() * 0.22),
    };
  });
  return <AnimatedCircle cx={center} cy={center} fill="none" stroke={BRAND} strokeWidth={2} animatedProps={props} />;
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
  const wordsRef = useRef<ComponentRef<typeof View>>(null);

  // 0 → 1 as it opens; `land` 0 → 1 as the words fly into the box.
  const shown = useSharedValue(0);
  const land = useSharedValue(0);
  const turn = useSharedValue(0);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const shrink = useSharedValue(0.55);

  useEffect(() => {
    if (!visible) return;
    land.set(0);
    shown.set(0);
    shown.set(withTiming(1, { duration: reduced ? 0 : 280, easing: Easing.out(Easing.cubic) }));
    turn.set(0);
    if (!reduced) turn.set(withRepeat(withTiming(TAU, { duration: LOOP_MS, easing: Easing.linear }), -1, false));
  }, [visible, reduced, shown, land, turn]);

  useEffect(() => {
    if (phase !== "landing") return;
    const fly = () =>
      land.set(
        withTiming(1, { duration: reduced ? 120 : LAND_MS, easing: EASE.fly }, (done) => {
          if (done) scheduleOnRN(onLanded);
        }),
      );
    const view = wordsRef.current;
    if (!view || !target) {
      dx.set(0);
      dy.set(height * 0.3);
      fly();
      return;
    }
    // From the middle of the words to the middle of the box, shrinking to the box's text size.
    view.measureInWindow((x, y, w, h) => {
      dx.set(target.x + target.width / 2 - (x + w / 2));
      dy.set(target.y + target.height / 2 - (y + h / 2));
      shrink.set(16 / 28);
      fly();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const backdrop = useAnimatedStyle(() => ({ opacity: shown.get() * (1 - Math.min(land.get() * 1.35, 1)) }));
  // The glows drift slowly in a small circle, so the screen feels alive without being busy.
  const glowTop = useAnimatedStyle(() => ({
    transform: [{ translateX: Math.sin(turn.get()) * 18 }, { translateY: Math.cos(turn.get()) * 12 }],
  }));
  const glowBottom = useAnimatedStyle(() => ({
    transform: [{ translateX: -Math.sin(turn.get()) * 26 }, { translateY: -Math.cos(turn.get()) * 10 }],
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
  const orbStyle = useAnimatedStyle(() => ({
    opacity: shown.get() * (1 - Math.min(land.get() * 2, 1)),
    transform: [{ scale: (0.8 + 0.2 * shown.get()) * (1 + level.get() * 0.1) * (1 - land.get() * 0.5) }],
  }));
  const dot = useAnimatedStyle(() => ({ opacity: 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(turn.get() * 3)) }));

  const glow = isDark ? 0.55 : 0.28;
  const size = ORB + RING_ROOM * 2;
  const recording = mode === "recording";
  const status = recording ? `Recording · ${clock(elapsedMs)}` : heard ? "Listening… keep going" : "Listening";

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onCancel}>
      <View style={StyleSheet.absoluteFill} pointerEvents={phase === "landing" ? "none" : "auto"}>
        {/* The theme's own ground, its soft accent rising from the bottom, and two brand glows. */}
        <Animated.View style={[StyleSheet.absoluteFill, backdrop]}>
          <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.bg} />
                <Stop offset="0.5" stopColor={colors.bg} />
                <Stop offset="1" stopColor={colors.accentSoft} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={width} height={height} fill="url(#ground)" />
          </Svg>
          <Animated.View style={[StyleSheet.absoluteFill, glowTop]}>
            <Svg width={width} height={height}>
              <Defs>
                <RadialGradient id="glowTop" cx={width / 2} cy={height * 0.34} r={width * 0.8} gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor={BRAND} stopOpacity={glow} />
                  <Stop offset="0.55" stopColor={BRAND} stopOpacity={glow * 0.22} />
                  <Stop offset="1" stopColor={BRAND} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Rect x={0} y={0} width={width} height={height} fill="url(#glowTop)" />
            </Svg>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, glowBottom]}>
            <Svg width={width} height={height}>
              <Defs>
                <RadialGradient id="glowBottom" cx={width * 0.15} cy={height * 0.95} r={width * 0.7} gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor={TINT} stopOpacity={isDark ? 0.22 : 0.35} />
                  <Stop offset="1" stopColor={TINT} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Rect x={0} y={0} width={width} height={height} fill="url(#glowBottom)" />
            </Svg>
          </Animated.View>
        </Animated.View>

        <View style={{ flex: 1, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }}>
          {/* What's happening, with a pulsing dot. */}
          <Animated.View style={chrome} className="items-center">
            <View className="flex-row items-center gap-2 rounded-full px-3 py-1.5" style={{ backgroundColor: `${colors.surface}CC` }}>
              <Animated.View
                className="h-2 w-2 rounded-full"
                style={[{ backgroundColor: recording ? colors.danger : BRAND }, dot]}
              />
              <Txt weight="medium" tone="muted" className="text-sm">
                {status}
              </Txt>
            </View>
          </Animated.View>

          <View className="flex-1 items-center justify-center">
            {/* The orb, with rings rippling out of it. */}
            <Animated.View style={[{ width: size, height: size }, orbStyle]} pointerEvents="none">
              <Svg width={size} height={size}>
                <Defs>
                  <RadialGradient id="orb" cx="38%" cy="30%" r="75%">
                    <Stop offset="0" stopColor={TINT} />
                    <Stop offset="0.55" stopColor={BRAND} />
                    <Stop offset="1" stopColor={BRAND_EDGE} />
                  </RadialGradient>
                </Defs>
                {reduced ? null : [0, 1, 2].map((i) => <Ripple key={i} i={i} level={level} turn={turn} center={size / 2} />)}
                <Circle cx={size / 2} cy={size / 2} r={ORB / 2 + 10} fill={BRAND} opacity={0.12} />
                <Circle cx={size / 2} cy={size / 2} r={ORB / 2} fill="url(#orb)" />
              </Svg>
              <View style={StyleSheet.absoluteFill} className="items-center justify-center">
                <Mic size={38} color={WHITE} strokeWidth={1.75} />
              </View>
            </Animated.View>

            {/* The waveform: it moves with your voice. */}
            <Animated.View style={[{ height: 56 }, chrome]} className="mt-2 flex-row items-center gap-[3px]" pointerEvents="none">
              {Array.from({ length: BARS }, (_, i) => (
                <Bar key={i} i={i} level={level} turn={turn} color={recording ? colors.danger : BRAND} />
              ))}
            </Animated.View>

            {/* The words as they're heard; they fly into the box when you're done. */}
            <View ref={wordsRef} collapsable={false} className="mt-6 w-full px-8" style={{ minHeight: 120 }}>
              <Animated.View style={wordsStyle}>
                {heard ? (
                  <Txt
                    weight="semibold"
                    className="text-center"
                    style={{ fontSize: 28, lineHeight: 36, letterSpacing: -0.4 }}
                    numberOfLines={5}
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                  >
                    {heard}
                  </Txt>
                ) : (
                  <>
                    <Txt weight="semibold" tone="muted" className="text-center" style={{ fontSize: 28, lineHeight: 36, letterSpacing: -0.4 }}>
                      {recording ? "Recording a voice note" : "Say what you spent"}
                    </Txt>
                    <Txt tone="faint" className="mt-3 text-center text-base leading-6">
                      {recording
                        ? "Finlyt reads it when you're done."
                        : "Like “auto 120 cash” or\n“lunch 450 with Rahul, he owes 200”"}
                    </Txt>
                  </>
                )}
              </Animated.View>
            </View>
          </View>

          {/* Cancel, and a big Done in thumb reach. */}
          <Animated.View style={chrome} className="items-center">
            <Txt tone="muted" className="mb-5 text-center text-sm">
              {heard ? "Tap Done when you've said it all" : recording ? "Tap Done to stop and send" : "It stops by itself when you pause"}
            </Txt>
            <View className="flex-row items-start justify-center gap-10">
              <View className="items-center">
                <Pressable
                  onPress={onCancel}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                  className="h-14 w-14 items-center justify-center rounded-full bg-surface active:opacity-70"
                >
                  <X size={24} color={colors.fg} strokeWidth={1.75} />
                </Pressable>
                <Txt tone="muted" className="mt-2 text-xs">
                  Cancel
                </Txt>
              </View>
              <View className="-mt-2.5 items-center">
                <Pressable
                  onPress={onStop}
                  accessibilityRole="button"
                  accessibilityLabel={heard ? "Done, send it" : "Stop"}
                  className="h-[76px] w-[76px] items-center justify-center rounded-full active:opacity-80"
                  style={{ backgroundColor: BRAND, shadowColor: BRAND, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8 }}
                >
                  <Check size={34} color={WHITE} strokeWidth={2.25} />
                </Pressable>
                <Txt weight="medium" className="mt-2 text-xs">
                  Done
                </Txt>
              </View>
              {/* Balances Cancel so Done sits in the middle. */}
              <View className="h-14 w-14" />
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

/** Loudness for the orb and the waveform, smoothed. Call `set` with 0..1 as readings arrive. */
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
