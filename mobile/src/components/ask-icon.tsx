// Ask Finlyt's icon: a chat bubble with the coin's eyes in it and a small sparkle in the corner,
// drawn on Lucide's 24-unit grid so it sits with the other icons. The eyes blink now and then.
import { useEffect } from "react";
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Ellipse, Path } from "react-native-svg";

import { useTheme } from "@/lib/theme";

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

// The bubble leaves its top-right corner open for the sparkle.
const BUBBLE = "M14 6H7a4 4 0 0 0-4 4v4a4 4 0 0 0 4 4h.5v3l3.5-3h4a4 4 0 0 0 4-4v-2";
const SPARKLE = "M19 1.6q.55 2.85 3.4 3.4-2.85.55-3.4 3.4-.55-2.85-3.4-3.4 2.85-.55 3.4-3.4z";
const EYE_RY = 1.9;

export function AskIcon({
  size = 24,
  color = "#000",
  strokeWidth = 1.75,
}: {
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const open = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;
    open.set(
      withRepeat(
        withDelay(
          3600,
          withSequence(withTiming(0.12, { duration: 70 }), withTiming(1, { duration: 110 })),
        ),
        -1,
      ),
    );
  }, [open, reduceMotion]);

  const eye = useAnimatedProps(() => ({ ry: EYE_RY * open.get() }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={BUBBLE} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <AnimatedEllipse cx={8.9} cy={12} rx={1.2} ry={EYE_RY} fill={color} animatedProps={eye} />
      <AnimatedEllipse cx={13.1} cy={12} rx={1.2} ry={EYE_RY} fill={color} animatedProps={eye} />
      <Path d={SPARKLE} fill={colors.accent} />
    </Svg>
  );
}
