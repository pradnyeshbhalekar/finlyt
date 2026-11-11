// The guided tour's pieces. <TourTarget id> wraps a part of a screen and reports where it is.
// <TourHost> (once, in the root layout) dims the app, cuts a rounded spotlight around the current
// part, rings it, and shows a short note with Back / Next. It switches tabs by itself as the tour
// moves on, and the app underneath can't be tapped until it ends.
import { router, usePathname } from "expo-router";
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentRef, type ReactNode } from "react";
import { BackHandler, Keyboard, Pressable, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { usePrefs } from "@/lib/prefs";
import { BRAND, useTheme } from "@/lib/theme";
import { tour, tourSteps, useTour, type Rect } from "@/lib/tour";

import { Coin } from "./brand";
import { Button, Txt } from "./ui";

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Space between a part and the edge of its spotlight. */
const PAD = 8;

type Measurable = ComponentRef<typeof View> & {
  getBoundingClientRect?: () => { x: number; y: number; width: number; height: number };
};

function measure(id: string, node: Measurable | null) {
  if (!node) return;
  // New-architecture views can answer synchronously; measureInWindow is the fallback.
  const rect = node.getBoundingClientRect?.();
  if (rect && rect.width > 0 && rect.height > 0) {
    tour.setRect(id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    return;
  }
  node.measureInWindow((x, y, width, height) => {
    if (width > 0 && height > 0) tour.setRect(id, { x, y, width, height });
  });
}

const activeRound = () => (tour.get().active ? tour.get().round : 0);

/** Marks a part of a screen the tour can light up. Lays out like a plain View. */
export function TourTarget({
  id,
  children,
  style,
  className,
}: {
  id: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  className?: string;
}) {
  const ref = useRef<Measurable>(null);
  const round = useSyncExternalStore(tour.subscribe, activeRound, activeRound);

  // Measure again whenever a step starts: once straight away, and once after the tab has switched.
  useEffect(() => {
    if (!round) return;
    const timers = [setTimeout(() => measure(id, ref.current), 60), setTimeout(() => measure(id, ref.current), 380)];
    return () => timers.forEach(clearTimeout);
  }, [round, id]);

  return (
    <View
      ref={ref}
      collapsable={false}
      onLayout={() => {
        if (tour.get().active) measure(id, ref.current);
      }}
      style={style}
      className={className}
    >
      {children}
    </View>
  );
}

type Hole = { x: number; y: number; w: number; h: number; r: number };

/** Ends the tour. `primary` is the last step's main button rather than Skip or Not now. */
function end(primary: boolean) {
  const { options } = tour.get();
  tour.stop();
  if (options.thenPlan) {
    router.push("/plan/chat");
  } else if (primary && options.from === "onboarding") {
    // Open the box on Home with the keyboard up, ready for the first entry.
    setTimeout(() => router.setParams({ compose: "type" }), 60);
  }
}

export function TourHost() {
  const { active, step, rects, options, round } = useTour();
  const prefs = usePrefs();
  const { colors, isDark } = useTheme();
  const { width: W, height: H } = useWindowDimensions();
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const steps = tourSteps(prefs.reviewBeforeSave);
  const last = steps.length - 1;
  const current = active ? steps[Math.min(step, last)] : undefined;
  const [gaveUp, setGaveUp] = useState(-1); // the round we stopped waiting for a target in

  const found = current?.target ? rects[current.target] : undefined;
  const rect: Rect | undefined = found && found.round === round ? found : undefined;
  const centred = !!current && (!current.target || (!rect && gaveUp === round));
  const ready = !!rect || centred;

  // Switch to the step's tab.
  const route = current?.route;
  useEffect(() => {
    if (route && pathname !== route) router.navigate(route);
  }, [route, pathname]);

  // A part that never reports (an empty screen, a slow load): show the note in the middle instead.
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setGaveUp(round), 1500);
    return () => clearTimeout(timer);
  }, [active, round]);

  useEffect(() => {
    if (active) Keyboard.dismiss();
  }, [active]);

  // Android's back button goes back a step, or ends the tour on the first one.
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (step > 0) tour.go(step - 1);
      else end(false);
      return true;
    });
    return () => sub.remove();
  }, [active, step]);

  // The spotlight slides from one part to the next.
  const hx = useSharedValue(W / 2);
  const hy = useSharedValue(H / 2);
  const hw = useSharedValue(0);
  const hh = useSharedValue(0);
  const hr = useSharedValue(0);
  const pulse = useSharedValue(1);

  const hole: Hole | null = rect
    ? {
        x: Math.max(rect.x - PAD, 4),
        y: Math.max(rect.y - PAD, 4),
        w: Math.min(rect.width + PAD * 2, W - 8),
        h: rect.height + PAD * 2,
        r: Math.min((current?.radius ?? (rect.height + PAD * 2) / 2) + PAD / 2, (rect.height + PAD * 2) / 2),
      }
    : null;

  const [toX, toY, toW, toH, toR] = hole ? [hole.x, hole.y, hole.w, hole.h, hole.r] : [W / 2, H / 2, 0, 0, 0];
  useEffect(() => {
    if (!ready) return; // keep the last spotlight until the next part has reported
    const t = { duration: reduceMotion ? 0 : 340, easing: Easing.out(Easing.cubic) };
    hx.set(withTiming(toX, t));
    hy.set(withTiming(toY, t));
    hw.set(withTiming(toW, t));
    hh.set(withTiming(toH, t));
    hr.set(withTiming(toR, t));
  }, [ready, toX, toY, toW, toH, toR, reduceMotion, hx, hy, hw, hh, hr]);

  useEffect(() => {
    if (!active || reduceMotion) return;
    pulse.set(
      withRepeat(
        withSequence(withTiming(1.04, { duration: 700, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 700 })),
        -1,
      ),
    );
  }, [active, reduceMotion, pulse]);

  const scrim = useAnimatedProps(() => {
    const x = hx.get();
    const y = hy.get();
    const w = hw.get();
    const h = hh.get();
    const r = Math.min(hr.get(), w / 2, h / 2);
    const outer = `M0 0H${W}V${H}H0Z`;
    if (w < 1 || h < 1) return { d: outer };
    const inner =
      `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
      `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
    return { d: outer + inner };
  });

  const ring = useAnimatedStyle(() => ({
    left: hx.get() - 3,
    top: hy.get() - 3,
    width: hw.get() + 6,
    height: hh.get() + 6,
    borderRadius: Math.min(hr.get(), hh.get() / 2) + 3,
    opacity: hw.get() < 1 ? 0 : 1,
    transform: [{ scale: pulse.get() }],
  }));

  if (!active || !current) return null;

  const isLast = step >= last;
  const finalLabel = options.thenPlan ? "Plan my month" : options.from === "onboarding" ? "Log my first expense" : "Done";
  const text = isLast && options.thenPlan ? "Next, a short chat to plan your month." : current.text;

  // The note goes under the part when it's in the top half of the screen, above it otherwise.
  const below = hole ? hole.y + hole.h / 2 < H * 0.5 : true;
  const notePlace: ViewStyle = centred
    ? { top: H * 0.3 }
    : hole && below
      ? { top: hole.y + hole.h + 14 }
      : { bottom: H - (hole?.y ?? H / 2) + 14 };

  return (
    <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} accessibilityViewIsModal>
      <Animated.View entering={FadeIn.duration(250)} style={{ position: "absolute", left: 0, top: 0 }}>
        <Svg width={W} height={H}>
          <AnimatedPath
            animatedProps={scrim}
            fill={isDark ? "rgba(46,52,78,0.78)" : "rgba(8,10,20,0.62)"}
            fillRule="evenodd"
          />
        </Svg>
      </Animated.View>
      <Animated.View style={[{ position: "absolute", borderWidth: 2, borderColor: BRAND, pointerEvents: "none" }, ring]} />

      {ready ? (
        <Animated.View
          key={`${step}-${round}`}
          entering={(below || centred ? FadeInDown : FadeIn).duration(280)}
          style={[
            {
              position: "absolute",
              left: 16,
              right: 16,
              backgroundColor: colors.bg,
              borderColor: colors.line,
              borderWidth: isDark ? 1 : 0,
              shadowColor: "#000",
              shadowOpacity: 0.2,
              shadowRadius: 18,
              elevation: 12,
            },
            notePlace,
          ]}
          className="rounded-3xl p-5"
        >
          <View className="flex-row items-center gap-3">
            <Coin size={30} variant="bare" mood={isLast ? "happy" : "default"} />
            <View className="flex-1 flex-row gap-1">
              {steps.map((s, i) => (
                <View
                  key={i}
                  className={`h-1 rounded-full ${i <= step ? "bg-brand" : "bg-line"}`}
                  style={{ flex: i === step ? 2 : 1 }}
                />
              ))}
            </View>
            {!isLast ? (
              <Pressable onPress={() => end(false)} hitSlop={10} accessibilityRole="button" className="pl-2">
                <Txt weight="medium" tone="muted" className="text-sm">
                  Skip
                </Txt>
              </Pressable>
            ) : null}
          </View>
          <Txt weight="semibold" className="mt-4 text-xl" style={{ letterSpacing: -0.3 }}>
            {current.title}
          </Txt>
          <Txt tone="muted" className="mt-1.5 text-base" style={{ lineHeight: 23 }}>
            {text}
          </Txt>
          <View className="mt-5 flex-row gap-3">
            {step > 0 && !isLast ? (
              <Button label="Back" variant="secondary" onPress={() => tour.go(step - 1)} className="flex-1" />
            ) : null}
            <Button
              label={isLast ? finalLabel : step === 0 ? "Show me around" : "Next"}
              onPress={() => (isLast ? end(true) : tour.go(step + 1))}
              className="flex-1"
            />
          </View>
          {isLast && options.from === "onboarding" && !options.thenPlan ? (
            <Pressable onPress={() => end(false)} hitSlop={8} accessibilityRole="button" className="mt-3 self-center">
              <Txt weight="medium" tone="muted" className="text-sm">
                Not now
              </Txt>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}
