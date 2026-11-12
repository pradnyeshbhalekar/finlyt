// First run after signing in, one thing at a time: hello, check-in times, how to save what you
// tell it, importing from an AI chat, and the weekly planning check-in (day and time). Each step
// opens with a picture made of the app's own pieces (the coin in its rings, a reminder as it shows
// on the phone, a plan card), then a title, a line or two and its choices, which come in one after
// another. Finishing starts the guided tour of the real app (lib/tour).
import { router, useLocalSearchParams } from "expo-router";
import {
  Bell,
  CalendarClock,
  Check,
  ChevronLeft,
  ClipboardPaste,
  Copy,
  CircleCheck,
  MessageSquareText,
  Mic,
  Target,
  Undo2,
  Zap,
  type LucideIcon,
} from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Coin } from "@/components/brand";
import { CoinHero, PlanPreview, ReminderPreview } from "@/components/hero-art";
import { ReminderEditor } from "@/components/reminder-editor";
import { formatClock, TimePickerSheet } from "@/components/time-picker";
import { Button, Icon, IconButton, Row, Screen, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { importGate } from "@/lib/import-gate";
import {
  DEFAULT_CHECK_IN,
  DEFAULT_REMINDERS,
  saveCheckIn,
  saveReminderTimes,
  WEEKDAYS,
  type CheckIn,
  type ReminderTime,
} from "@/lib/notifications";
import { usePrefs } from "@/lib/prefs";
import { BRAND, useTheme, WHITE } from "@/lib/theme";
import { tour, TOUR_VERSION } from "@/lib/tour";

type Step = "welcome" | "checkins" | "saving" | "import" | "plan";

/** Wraps a piece of a step so it slides in after the ones before it. */
function In({ i, children }: { i: number; children: ReactNode }) {
  return <Animated.View entering={FadeInDown.delay(110 * i + 60).duration(450)}>{children}</Animated.View>;
}

function Title({ children }: { children: ReactNode }) {
  return (
    <Txt weight="bold" style={{ fontSize: 30, letterSpacing: -0.8, lineHeight: 36 }}>
      {children}
    </Txt>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return (
    <Txt tone="muted" className="mt-2.5 text-base" style={{ lineHeight: 24 }}>
      {children}
    </Txt>
  );
}

/** One of the four things Finlyt does, as a small card in a two-column grid. */
function Feature({ icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <View className="flex-1 rounded-3xl bg-surface p-4">
      <View className="h-9 w-9 items-center justify-center rounded-full bg-accent-soft">
        <Icon icon={icon} size={17} tone="accent" />
      </View>
      <Txt weight="semibold" className="mt-3 text-base">
        {title}
      </Txt>
      <Txt tone="muted" className="mt-1 text-sm" style={{ lineHeight: 19 }}>
        {text}
      </Txt>
    </View>
  );
}

/** A choice card with a radio dot and a tiny picture of what it means. */
function Choice({
  icon,
  title,
  text,
  selected,
  onPress,
  preview,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  selected: boolean;
  onPress: () => void;
  preview: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={`mb-3 rounded-3xl p-4 ${selected ? "bg-accent-soft" : "bg-surface"}`}
      style={{ borderWidth: 2, borderColor: selected ? BRAND : "transparent" }}
    >
      <View className="flex-row gap-3">
        <Icon icon={icon} size={22} tone={selected ? "accent" : "muted"} />
        <View className="flex-1">
          <Txt weight="semibold" className="text-base">
            {title}
          </Txt>
          <Txt tone="muted" className="mt-1 text-sm" style={{ lineHeight: 20 }}>
            {text}
          </Txt>
        </View>
        <View
          className="h-6 w-6 items-center justify-center rounded-full"
          style={{ borderWidth: 2, borderColor: selected ? BRAND : colors.line, backgroundColor: selected ? BRAND : "transparent" }}
        >
          {selected ? <Check size={14} color={WHITE} strokeWidth={3} /> : null}
        </View>
      </View>
      <View className="ml-9 mt-3">{preview}</View>
    </Pressable>
  );
}

/** The quick check, small: "Look right?" with its Save button. */
function CheckPreview() {
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center gap-3 rounded-2xl px-3 py-2.5" style={{ backgroundColor: colors.bg }}>
      <View className="flex-1">
        <Txt weight="medium" className="text-sm">
          Chai · ₹40
        </Txt>
        <Txt tone="muted" className="text-xs">
          Food · Cash. Look right?
        </Txt>
      </View>
      <View className="h-8 flex-row items-center gap-1 rounded-full bg-brand px-3">
        <Check size={13} color={WHITE} strokeWidth={2.4} />
        <Txt weight="semibold" tone="onBrand" className="text-xs">
          Save
        </Txt>
      </View>
    </View>
  );
}

/** The "Saved · Undo" note, small. */
function SavedPreview() {
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center gap-2.5 rounded-2xl bg-fg px-3 py-2.5">
      <Coin size={20} variant="bare" mood="happy" />
      <Txt weight="medium" tone="inverse" className="flex-1 text-sm">
        Saved 1 entry
      </Txt>
      <Undo2 size={14} color={colors.bg} strokeWidth={1.75} />
      <Txt weight="semibold" tone="inverse" className="text-xs">
        Undo
      </Txt>
    </View>
  );
}

/** Numbered steps joined by a line. */
function Steps({ items }: { items: { icon: LucideIcon; title: string; text: string }[] }) {
  return (
    <View>
      {items.map((item, i) => (
        <View key={item.title} className="flex-row gap-4">
          <View className="items-center">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
              <Icon icon={item.icon} size={18} tone="accent" />
            </View>
            {i < items.length - 1 ? <View className="my-1 w-0.5 flex-1 rounded-full bg-line" /> : null}
          </View>
          <View className="flex-1 pb-5 pt-1">
            <Txt weight="semibold" className="text-base">
              {i + 1}. {item.title}
            </Txt>
            <Txt tone="muted" className="mt-0.5 text-sm" style={{ lineHeight: 20 }}>
              {item.text}
            </Txt>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const prefs = usePrefs();
  const { user } = useAuth();
  const steps: Step[] = ["welcome", "checkins", "saving", "import", "plan"];
  const { step: startAt } = useLocalSearchParams<{ step?: string }>();
  const [index, setIndex] = useState(() => Math.max(steps.indexOf(startAt as Step), 0));
  const [times, setTimes] = useState<ReminderTime[]>(DEFAULT_REMINDERS);
  const [review, setReview] = useState(prefs.reviewBeforeSave);
  const [busy, setBusy] = useState(false);
  const [checkIn, setCheckIn] = useState<CheckIn>(DEFAULT_CHECK_IN);
  const [pickingCheckIn, setPickingCheckIn] = useState(false);
  const [pickRound, setPickRound] = useState(0);
  const step = steps[index];
  const firstName = user?.name?.split(" ")[0];

  const next = () => setIndex((i) => Math.min(i + 1, steps.length - 1));

  async function finish(thenPlan: boolean) {
    setBusy(true);
    try {
      await saveReminderTimes(times); // asks for notification permission
      await saveCheckIn(checkIn); // its reminder, and the day for the server
    } finally {
      // Switches the app to Home; the tour below counts as seen, so Home doesn't start it again.
      prefs.update({ reviewBeforeSave: review, onboarded: true, tourVersion: TOUR_VERSION });
      // Then the tour of the real app, once Home is up; it goes on to the planning chat if they asked.
      setTimeout(() => tour.start({ from: "onboarding", thenPlan }), 700);
    }
  }

  let body: ReactNode;
  let actions: ReactNode;
  if (step === "welcome") {
    body = (
      <>
        <In i={0}>
          <View className="-mx-2 mb-6">
            <CoinHero size={250} />
          </View>
        </In>
        <In i={1}>
          <Txt weight="medium" tone="accent" className="text-base">
            {firstName ? `Hi ${firstName}` : "Hi there"}
          </Txt>
        </In>
        <In i={2}>
          <View className="mt-1">
            <Title>Here&apos;s what Finlyt does for you</Title>
          </View>
        </In>
        <In i={3}>
          <View className="mt-6 flex-row gap-3">
            <Feature icon={Mic} title="Plain words" text="Type or say “chai 40 cash, auto 120”." />
            <Feature icon={Bell} title="Reminders" text="A nudge at lunch, evening and night." />
          </View>
        </In>
        <In i={4}>
          <View className="mt-3 flex-row gap-3">
            <Feature icon={Target} title="A daily limit" text="A short weekly chat turns your budget into a number." />
            <Feature icon={ClipboardPaste} title="Your history" text="Tracked spending with an AI? Bring it in." />
          </View>
        </In>
      </>
    );
    actions = <Button label="Get started" onPress={next} />;
  } else if (step === "checkins") {
    body = (
      <>
        <In i={0}>
          <View className="mb-7 mt-2">
            <ReminderPreview
              title="Evening check-in"
              body="Anything since lunch? Log it while you remember."
              time="6:00 PM"
            />
          </View>
        </In>
        <In i={1}>
          <Title>When should I check in?</Title>
        </In>
        <In i={2}>
          <Lead>I&apos;ll remind you at these times. Tap one to change it, or add another.</Lead>
        </In>
        <In i={3}>
          <View className="mt-5">
            <ReminderEditor times={times} onChange={setTimes} />
          </View>
        </In>
      </>
    );
    actions = <Button label="Continue" onPress={next} />;
  } else if (step === "saving") {
    body = (
      <>
        <In i={0}>
          <View className="mb-6">
            <Coin size={56} variant="bare" mood="thinking" />
          </View>
        </In>
        <In i={1}>
          <Title>When you tell me what you spent…</Title>
        </In>
        <In i={2}>
          <Lead>You can change this any time in Settings.</Lead>
        </In>
        <View className="mt-6">
          <In i={3}>
            <Choice
              icon={CircleCheck}
              title="Show me first"
              text="I'll show what I understood. One tap to save, or fix it."
              selected={review}
              onPress={() => setReview(true)}
              preview={<CheckPreview />}
            />
          </In>
          <In i={4}>
            <Choice
              icon={Zap}
              title="Save straight away"
              text="Saved the moment you send it, with an Undo just in case."
              selected={!review}
              onPress={() => setReview(false)}
              preview={<SavedPreview />}
            />
          </In>
        </View>
      </>
    );
    actions = <Button label="Continue" onPress={next} />;
  } else if (step === "import") {
    body = (
      <>
        <In i={0}>
          <View className="mb-6 flex-row flex-wrap gap-2">
            {["Claude", "ChatGPT", "Gemini"].map((name) => (
              <View key={name} className="flex-row items-center gap-2 rounded-full bg-surface px-3.5 py-2">
                <Icon icon={MessageSquareText} size={15} tone="accent" />
                <Txt weight="medium" className="text-sm">
                  {name}
                </Txt>
              </View>
            ))}
          </View>
        </In>
        <In i={1}>
          <Title>Tracked spending with an AI?</Title>
        </In>
        <In i={2}>
          <Lead>
            If you&apos;ve been telling Claude, ChatGPT or Gemini what you spent, Finlyt can bring it all in: splits,
            paybacks, and the budget or plan you made for this month. Your weekly check-ins get better with it.
          </Lead>
        </In>
        <In i={3}>
          <View className="mt-6">
            <Steps
              items={[
                { icon: Copy, title: "Copy a prompt", text: "Finlyt writes it with your categories and accounts." },
                {
                  icon: MessageSquareText,
                  title: "Paste it into that chat",
                  text: "The same conversation where you tracked your spending.",
                },
                {
                  icon: ClipboardPaste,
                  title: "Paste the reply back",
                  text: "Check the list, untick anything, and import. One tap undoes it.",
                },
              ]}
            />
          </View>
        </In>
        <In i={4}>
          <Txt tone="muted" className="text-sm">
            This is optional. Skip it if you haven&apos;t, and you can always import later from Settings.
          </Txt>
        </In>
      </>
    );
    actions = (
      <View className="gap-3">
        <Button
          label="Import from a chat"
          onPress={() => {
            next(); // coming back from the import lands on the next step
            importGate.open();
            // Let the navigator see the screen is reachable before going to it.
            setTimeout(() => router.push({ pathname: "/import", params: { from: "onboarding" } }), 0);
          }}
        />
        <Button label="Skip, I don't have one" variant="ghost" onPress={next} />
      </View>
    );
  } else {
    body = (
      <>
        <In i={0}>
          <View className="mb-7 mt-2">
            <PlanPreview />
          </View>
        </In>
        <In i={1}>
          <Title>Plan your week</Title>
        </In>
        <In i={2}>
          <Lead>
            Once a week Finlyt asks what&apos;s coming up, like a trip, a family dinner or a bill, and sets your
            limits: one for usual days, and a few bigger days if your weeks have them. Whatever you don&apos;t
            spend is kept aside for surprises.
          </Lead>
        </In>
        <In i={3}>
          <View className="-mx-3 mt-5">
            <Row
              onPress={() => {
                setPickRound((r) => r + 1);
                setPickingCheckIn(true);
              }}
              leading={
                <View className="h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
                  <Icon icon={CalendarClock} size={19} tone="accent" />
                </View>
              }
              title={`Every ${WEEKDAYS[checkIn.weekday]}`}
              subtitle={`${formatClock(checkIn)} · tap to change. You can change it later in Plan.`}
            />
          </View>
        </In>
        <TimePickerSheet
          key={pickRound}
          visible={pickingCheckIn}
          initial={checkIn}
          initialWeekday={checkIn.weekday}
          onClose={() => setPickingCheckIn(false)}
          onDone={(time, weekday) => {
            setCheckIn({ ...time, weekday });
            setPickingCheckIn(false);
          }}
        />
      </>
    );
    actions = (
      <View className="gap-3">
        <Button label="Plan with Finlyt" onPress={() => void finish(true)} loading={busy} />
        <Button label="Maybe later" variant="ghost" onPress={() => void finish(false)} disabled={busy} />
      </View>
    );
  }

  return (
    <Screen>
      <View className="h-12 flex-row items-center gap-2 px-2">
        {index > 0 ? (
          <IconButton icon={ChevronLeft} label="Back" onPress={() => setIndex(index - 1)} tone="muted" />
        ) : (
          <View className="w-11" />
        )}
        <View className="flex-1 flex-row gap-1.5">
          {steps.map((s, i) => (
            <View key={s} className={`h-1.5 flex-1 rounded-full ${i <= index ? "bg-brand" : "bg-line"}`} />
          ))}
        </View>
        <Txt tone="muted" className="w-11 text-center text-xs">
          {index + 1} of {steps.length}
        </Txt>
      </View>
      {/* A new key per step replays the entrance animations. */}
      <ScrollView key={step} className="flex-1" contentContainerClassName="px-6 pb-6 pt-5">
        {body}
      </ScrollView>
      <Animated.View key={`${step}-actions`} entering={FadeInDown.delay(300).duration(400)}>
        <View className="px-6 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
          {actions}
        </View>
      </Animated.View>
    </Screen>
  );
}
