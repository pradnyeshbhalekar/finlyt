// Pictures for sign-in and onboarding, made of the app's own pieces so they follow the theme:
// the coin in soft rings with a few entries floating around it, a reminder as it shows on the
// phone, and a small plan card.
import { Bell, Car, Target, Utensils, type LucideIcon } from "lucide-react-native";
import { useEffect, type ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/lib/theme";

import { Coin } from "./brand";
import { Icon, Txt } from "./ui";

/** Bobs up and down forever, starting after `delay`. */
function Float({ delay, distance = 6, style, children }: { delay: number; distance?: number; style?: ViewStyle; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    y.set(
      withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(-distance, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
            withTiming(0, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
        ),
      ),
    );
  }, [delay, distance, reduceMotion, y]);
  const moving = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  return (
    <Animated.View entering={FadeIn.delay(300 + delay / 2).duration(600)} style={[{ position: "absolute" }, style]}>
      <Animated.View style={moving}>{children}</Animated.View>
    </Animated.View>
  );
}

function Chip({ icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  const { colors, isDark } = useTheme();
  return (
    <View
      className="flex-row items-center gap-2 rounded-2xl py-2 pl-2 pr-3"
      style={{
        backgroundColor: isDark ? colors.surface : colors.bg,
        borderWidth: 1,
        borderColor: colors.line,
        shadowColor: "#000",
        shadowOpacity: isDark ? 0 : 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: isDark ? 0 : 3,
      }}
    >
      <View className="h-7 w-7 items-center justify-center rounded-full bg-accent-soft">
        <Icon icon={icon} size={14} tone="accent" />
      </View>
      <Txt weight="medium" className="text-sm">
        {label}
      </Txt>
      <Txt weight="semibold" className="text-sm">
        {value}
      </Txt>
    </View>
  );
}

/** The coin in soft rings, with entries floating around it. `size` is the whole picture's height. */
export function CoinHero({ size = 300, chips = true }: { size?: number; chips?: boolean }) {
  const ring = (d: number, opacity: number) => (
    <View
      className="absolute rounded-full bg-accent-soft"
      style={{ width: d, height: d, opacity, left: "50%", top: "50%", marginLeft: -d / 2, marginTop: -d / 2 }}
    />
  );
  const coin = size * 0.4;
  return (
    <View style={{ height: size, width: "100%" }}>
      {ring(size * 0.98, 0.35)}
      {ring(size * 0.74, 0.6)}
      {ring(size * 0.52, 1)}
      <View className="absolute" style={{ left: "50%", top: "50%", marginLeft: -coin / 2, marginTop: -coin / 2 }}>
        <Coin size={coin} variant="bare" />
      </View>
      {chips ? (
        <>
          <Float delay={0} style={{ left: "4%", top: size * 0.12 }}>
            <Chip icon={Utensils} label="Chai" value="₹40" />
          </Float>
          <Float delay={600} style={{ right: "3%", top: size * 0.4 }}>
            <Chip icon={Car} label="Auto" value="₹120" />
          </Float>
          <Float delay={1200} style={{ left: "8%", bottom: size * 0.08 }}>
            <Chip icon={Target} label="Left today" value="₹490" />
          </Float>
        </>
      ) : null}
    </View>
  );
}

/** A Finlyt reminder, the way it shows on the phone. */
export function ReminderPreview({ title, body, time }: { title: string; body: string; time: string }) {
  const { colors } = useTheme();
  return (
    <Float delay={0} distance={4} style={{ position: "relative" }}>
      <View className="flex-row gap-3 rounded-3xl p-4" style={{ backgroundColor: colors.surface }}>
        <View className="h-10 w-10 items-center justify-center rounded-full bg-brand">
          <Bell size={18} color="#FFFFFF" strokeWidth={2} />
        </View>
        <View className="flex-1">
          <View className="flex-row items-center justify-between">
            <Txt weight="semibold" className="text-sm">
              Finlyt · {title}
            </Txt>
            <Txt tone="faint" className="text-xs">
              {time}
            </Txt>
          </View>
          <Txt tone="muted" className="mt-0.5 text-sm">
            {body}
          </Txt>
        </View>
      </View>
    </Float>
  );
}

/** A small plan card: today's limit, what's left, and what's been saved for surprises. */
export function PlanPreview() {
  const { colors } = useTheme();
  return (
    <Float delay={0} distance={4} style={{ position: "relative" }}>
      <View className="rounded-3xl p-5" style={{ backgroundColor: colors.surface }}>
        <View className="flex-row items-center justify-between">
          <Txt tone="muted" className="text-sm">
            Today
          </Txt>
          <View className="flex-row items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1">
            <Coin size={16} variant="bare" />
            <Txt weight="medium" tone="accent" className="text-xs">
              ₹1,240 saved for surprises
            </Txt>
          </View>
        </View>
        <Txt weight="bold" className="mt-1 text-4xl" style={{ letterSpacing: -1 }}>
          ₹490
        </Txt>
        <Txt tone="muted" className="text-sm">
          left of today&apos;s ₹650
        </Txt>
        <View className="mt-3 h-2 overflow-hidden rounded-full" style={{ backgroundColor: colors.line }}>
          <View className="h-2 rounded-full" style={{ width: "25%", backgroundColor: colors.chart }} />
        </View>
      </View>
    </Float>
  );
}
