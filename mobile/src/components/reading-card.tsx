// "Reading that…" on Home while Finlyt reads a note: the thinking coin, and a soft sheen in the
// brand colour sweeping across the card, so the wait looks like work is happening. The answer
// card slides in where this was.
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { SLOW_NOTE } from "@/lib/reply-alert";
import { BRAND, useTheme } from "@/lib/theme";

import { Coin } from "./brand";
import { Txt } from "./ui";

export function ReadingCard({ slow, label = "Reading that…" }: { slow: boolean; label?: string }) {
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const sweep = useSharedValue(-1);

  useEffect(() => {
    if (reduced) return;
    sweep.set(withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }), -1, false));
  }, [reduced, sweep]);

  const sheen = useAnimatedStyle(() => ({ transform: [{ translateX: sweep.get() * width }] }));

  return (
    <Animated.View
      entering={FadeInDown.duration(260)}
      exiting={FadeOut.duration(150)}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      className="mt-6 overflow-hidden rounded-3xl bg-surface"
    >
      {reduced || !width ? null : (
        <Animated.View style={[StyleSheet.absoluteFill, sheen]} pointerEvents="none">
          <Svg width={width} height="100%">
            <Defs>
              <LinearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={BRAND} stopOpacity={0} />
                <Stop offset="0.5" stopColor={BRAND} stopOpacity={isDark ? 0.2 : 0.1} />
                <Stop offset="1" stopColor={BRAND} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={width} height="100%" fill="url(#sheen)" />
          </Svg>
        </Animated.View>
      )}
      <View className="flex-row items-center gap-3 p-4">
        <Coin size={36} mood="thinking" variant="bare" />
        <View className="flex-1">
          <Txt tone="muted">{label}</Txt>
          {slow ? (
            <Txt tone="faint" className="mt-0.5 text-sm">
              {SLOW_NOTE}
            </Txt>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}
