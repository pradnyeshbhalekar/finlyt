// The tour's pieces. <TourTarget id> wraps a part of a screen and reports where it is.
// <TourHost> (once, in the root layout) shows the tour on top of the app:
// - first an overview of everything Finlyt does, on one screen, with "Show me around";
// - then, step by step, it dims the app, cuts a rounded spotlight around one part, rings it, and
//   shows a note (an icon, a title, a few plain words, Back / Next), switching tabs by itself;
// - and a last card that sums up the three ways to log.
// The app underneath can't be tapped until the tour ends. Android's back button goes a step back.
import { router, usePathname } from "expo-router";
import {
  Bell,
  CalendarDays,
  Download,
  HandCoins,
  History,
  Keyboard as KeyboardIcon,
  Mic,
  PiggyBank,
  Plus,
  Target,
  type LucideIcon,
} from "lucide-react-native";
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentRef, type ReactNode } from "react";
import {
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { usePrefs } from "@/lib/prefs";
import { BRAND, useTheme } from "@/lib/theme";
import { tour, tourSteps, useTour, type Rect, type TourStep } from "@/lib/tour";

import { AskIcon } from "./ask-icon";
import { Coin } from "./brand";
import { Button, Icon, SectionLabel, Txt, type IconType } from "./ui";

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

/** Ends the tour. `primary` is the last card's main button rather than Skip or Not now. */
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

/** An icon in a soft brand-coloured circle. */
function Badge({ icon, size = 40 }: { icon: IconType; size?: number }) {
  return (
    <View className="items-center justify-center rounded-full bg-accent-soft" style={{ width: size, height: size }}>
      <Icon icon={icon} size={size * 0.47} tone="accent" />
    </View>
  );
}

/** One of the three ways to log, as a row. */
function Way({ icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <View className="flex-row items-center gap-3 rounded-2xl bg-surface px-3.5 py-3">
      <Badge icon={icon} size={38} />
      <View className="flex-1">
        <Txt weight="semibold" className="text-base">
          {title}
        </Txt>
        <Txt tone="muted" className="text-sm" style={{ lineHeight: 19 }}>
          {text}
        </Txt>
      </View>
    </View>
  );
}

/** A feature in the overview's grid. */
function Feature({ icon, title, text }: { icon: IconType; title: string; text: string }) {
  return (
    <View className="rounded-2xl bg-surface p-3.5" style={{ width: "48.5%" }}>
      <Icon icon={icon} size={20} tone="accent" />
      <Txt weight="semibold" className="mt-2" style={{ fontSize: 15 }}>
        {title}
      </Txt>
      <Txt tone="muted" className="mt-0.5 text-xs" style={{ lineHeight: 16 }}>
        {text}
      </Txt>
    </View>
  );
}

const FEATURES: { icon: IconType; title: string; text: string }[] = [
  { icon: CalendarDays, title: "Today", text: "What you spent, and what's left of today's limit" },
  { icon: HandCoins, title: "Owed", text: "Who owes you, and who you owe" },
  { icon: Target, title: "Plan", text: "A monthly budget turned into a daily limit" },
  { icon: AskIcon, title: "Ask", text: "Questions about your money, in your words" },
  { icon: History, title: "History", text: "Every entry, day by day" },
  { icon: PiggyBank, title: "Goals", text: "Save up for a trip, a phone, anything" },
  { icon: Bell, title: "Reminders", text: "A nudge at the times you pick" },
  { icon: Download, title: "Import", text: "Bring in what you tracked with an AI" },
];

/** Step one: everything Finlyt does, on one screen. */
function Overview({ reviewBeforeSave }: { reviewBeforeSave: boolean }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      entering={FadeInDown.duration(380)}
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        top: insets.top + 12,
        bottom: Math.max(insets.bottom, 12),
        backgroundColor: colors.bg,
        borderRadius: 32,
        borderWidth: isDark ? 1 : 0,
        borderColor: colors.line,
        overflow: "hidden",
        elevation: 16,
      }}
    >
      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center gap-3">
          <Coin size={52} variant="bare" />
          <View className="flex-1">
            <Txt tone="muted" className="text-sm">
              Welcome to Finlyt
            </Txt>
            <Txt weight="bold" style={{ fontSize: 24, letterSpacing: -0.5, lineHeight: 30 }}>
              Everything in one minute
            </Txt>
          </View>
        </View>
        <Txt tone="muted" className="mt-3 text-base" style={{ lineHeight: 23 }}>
          Here&apos;s what Finlyt does. Then I&apos;ll show you where each thing is on your screen.
        </Txt>

        <SectionLabel className="mb-2.5 mt-6">Log what you spent, 3 ways</SectionLabel>
        <View className="gap-2">
          <Way icon={KeyboardIcon} title="Type it" text="“chai 40 cash, auto 120” in the box on Home" />
          <Way icon={Mic} title="Say it" text="Tap the mic and talk" />
          <Way icon={Plus} title="Fill in a form" text="Tap + for the amount, what it was and how you paid" />
        </View>
        <Txt tone="muted" className="mt-2.5 text-sm" style={{ lineHeight: 19 }}>
          {reviewBeforeSave
            ? "Finlyt shows what it understood, and you tap Save."
            : "It's saved straight away, and you can tap Undo."}
        </Txt>

        <SectionLabel className="mb-2.5 mt-6">And everything else</SectionLabel>
        <View className="flex-row flex-wrap justify-between gap-y-2.5">
          {FEATURES.map((f) => (
            <Feature key={f.title} icon={f.icon} title={f.title} text={f.text} />
          ))}
        </View>
      </ScrollView>
      <View className="gap-1 border-t border-line px-5 pb-4 pt-3">
        <Button label="Show me around" onPress={() => tour.go(1)} />
        <Button label="Skip the tour" variant="ghost" onPress={() => end(false)} />
      </View>
    </Animated.View>
  );
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
  const current: TourStep | undefined = active ? steps[Math.min(step, last)] : undefined;
  const [gaveUp, setGaveUp] = useState(-1); // the round we stopped waiting for a target in

  const found = current?.target ? rects[current.target] : undefined;
  const rect: Rect | undefined = found && found.round === round ? found : undefined;
  const spot = current?.kind === "spot";
  const centred = !!current && (!spot || (!rect && gaveUp === round));
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

  const hole: Hole | null =
    spot && rect
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
        withSequence(withTiming(1.05, { duration: 700, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 700 })),
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
    left: hx.get() - 4,
    top: hy.get() - 4,
    width: hw.get() + 8,
    height: hh.get() + 8,
    borderRadius: Math.min(hr.get(), hh.get() / 2) + 4,
    opacity: hw.get() < 1 ? 0 : 1,
    transform: [{ scale: pulse.get() }],
  }));

  if (!active || !current) return null;

  const isEnd = current.kind === "end";
  const spotCount = steps.filter((s) => s.kind === "spot").length;
  const spotIndex = steps.slice(0, step + 1).filter((s) => s.kind === "spot").length; // 1-based
  const finalLabel = options.thenPlan ? "Plan my month" : options.from === "onboarding" ? "Log my first expense" : "Done";
  const text = isEnd
    ? options.thenPlan
      ? "Next, a short chat to plan your month."
      : options.from === "onboarding"
        ? current.text
        : "That's everything. You'll find this tour in Settings → How Finlyt works whenever you need it."
    : current.text;

  // The note goes under the part when it's in the top half of the screen, above it otherwise.
  const below = hole ? hole.y + hole.h / 2 < H * 0.5 : true;
  const notePlace: ViewStyle = centred
    ? { top: H * 0.2 }
    : hole && below
      ? { top: hole.y + hole.h + 16 }
      : { bottom: H - (hole?.y ?? H / 2) + 16 };

  return (
    <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} accessibilityViewIsModal>
      <Animated.View entering={FadeIn.duration(250)} style={{ position: "absolute", left: 0, top: 0 }}>
        <Svg width={W} height={H}>
          <AnimatedPath
            animatedProps={scrim}
            fill={isDark ? "rgba(46,52,78,0.82)" : "rgba(8,10,20,0.66)"}
            fillRule="evenodd"
          />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[{ position: "absolute", borderWidth: 2.5, borderColor: BRAND, pointerEvents: "none" }, ring]}
      />

      {current.kind === "overview" ? (
        <Overview reviewBeforeSave={prefs.reviewBeforeSave} />
      ) : ready ? (
        <Animated.View
          key={`${step}-${round}`}
          entering={(below || centred ? FadeInDown : FadeIn).duration(280)}
          style={[
            {
              position: "absolute",
              left: 14,
              right: 14,
              backgroundColor: colors.bg,
              borderColor: colors.line,
              borderWidth: isDark ? 1 : 0,
              shadowColor: "#000",
              shadowOpacity: 0.22,
              shadowRadius: 18,
              elevation: 12,
            },
            notePlace,
          ]}
          className="rounded-3xl p-5"
        >
          {isEnd ? (
            <View className="items-center">
              <Coin size={60} variant="bare" mood="happy" />
              <Txt weight="bold" className="mt-3 text-center text-2xl" style={{ letterSpacing: -0.4 }}>
                {current.title}
              </Txt>
              <Txt tone="muted" className="mt-1.5 text-center text-base" style={{ lineHeight: 23 }}>
                {text}
              </Txt>
              <View className="mt-4 flex-row gap-2">
                {[
                  { icon: KeyboardIcon, label: "Type it" },
                  { icon: Mic, label: "Say it" },
                  { icon: Plus, label: "Fill a form" },
                ].map((w) => (
                  <View key={w.label} className="flex-1 items-center gap-1.5 rounded-2xl bg-surface py-3">
                    <Icon icon={w.icon} size={20} tone="accent" />
                    <Txt weight="medium" className="text-xs">
                      {w.label}
                    </Txt>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <>
              <View className="flex-row items-center gap-3">
                <Badge icon={current.icon} />
                <View className="flex-1">
                  <Txt tone="muted" className="text-xs">
                    {spotIndex} of {spotCount}
                  </Txt>
                  <View className="mt-1.5 flex-row gap-1">
                    {Array.from({ length: spotCount }, (_, i) => (
                      <View
                        key={i}
                        className={`h-1 rounded-full ${i < spotIndex ? "bg-brand" : "bg-line"}`}
                        style={{ flex: i === spotIndex - 1 ? 2 : 1 }}
                      />
                    ))}
                  </View>
                </View>
                <Pressable onPress={() => end(false)} hitSlop={10} accessibilityRole="button" className="pl-2">
                  <Txt weight="medium" tone="muted" className="text-sm">
                    Skip
                  </Txt>
                </Pressable>
              </View>
              <Txt weight="semibold" className="mt-4 text-xl" style={{ letterSpacing: -0.3 }}>
                {current.title}
              </Txt>
              <Txt tone="muted" className="mt-1.5 text-base" style={{ lineHeight: 23 }}>
                {text}
              </Txt>
            </>
          )}
          <View className="mt-5 flex-row gap-3">
            {step > 1 && !isEnd ? (
              <Button label="Back" variant="secondary" onPress={() => tour.go(step - 1)} className="flex-1" />
            ) : null}
            <Button
              label={isEnd ? finalLabel : "Next"}
              onPress={() => (isEnd ? end(true) : tour.go(step + 1))}
              className="flex-1"
            />
          </View>
          {isEnd && options.from === "onboarding" && !options.thenPlan ? (
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
