// First run after signing in, one thing at a time: how Finlyt works in three lines, a practice
// box where you log one expense to see what happens (nothing is saved; the "check before saving"
// choice sits under it, where it now means something), reminder times, importing from an AI chat,
// and the weekly planning check-in (day and time). Each step has one main button at the bottom,
// in reach of a thumb. Finishing starts the guided tour of the real app (lib/tour).
import { router, useLocalSearchParams } from "expo-router";
import {
  ArrowUp,
  CalendarClock,
  ChartColumn,
  Check,
  ChevronLeft,
  ClipboardPaste,
  Copy,
  MessageSquareText,
  Sparkles,
  type LucideIcon,
} from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Keyboard, Pressable, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Coin } from "@/components/brand";
import { CategoryBadge } from "@/components/category-icon";
import { CoinHero, PlanPreview, ReminderPreview } from "@/components/hero-art";
import { ReminderEditor } from "@/components/reminder-editor";
import { formatClock, TimePickerSheet } from "@/components/time-picker";
import { Button, Icon, IconButton, Row, Screen, SwitchRow, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { importGate } from "@/lib/import-gate";
import {
  DEFAULT_CHECK_IN,
  DEFAULT_REMINDERS,
  ensureNotificationPermission,
  saveCheckIn,
  saveReminderTimes,
  WEEKDAYS,
  type CheckIn,
  type ReminderTime,
} from "@/lib/notifications";
import { formatPaise } from "@/lib/money";
import { practiceParse, type PracticeEntry } from "@/lib/practice";
import { usePrefs } from "@/lib/prefs";
import { BRAND, fonts, useTheme, WHITE } from "@/lib/theme";
import { tour, TOUR_VERSION } from "@/lib/tour";

type Step = "welcome" | "try" | "checkins" | "import" | "plan";

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

/** What people type, to tap instead of typing. */
const PRACTICE_EXAMPLES = ["chai 40 cash", "auto 120", "lunch 450 with Rahul, he owes 200"];

/**
 * Log one expense for practice. Tap an example (or type your own) and see what Finlyt makes of
 * it: with the check on, a "Look right?" card with Save; with it off, saved straight away.
 * Read on the phone (lib/practice); nothing is sent or saved.
 */
function Practice({ review, onDone }: { review: boolean; onDone: () => void }) {
  const { colors } = useTheme();
  const [text, setText] = useState("");
  const [entry, setEntry] = useState<PracticeEntry | null>(null);
  const [saved, setSaved] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  function read(words: string) {
    Keyboard.dismiss();
    const found = practiceParse(words);
    setRound((r) => r + 1);
    setEntry(found);
    setSaved(found !== null && !review);
    setHint(found ? null : "Add an amount, like “chai 40”.");
    if (found && !review) onDone();
  }

  function tryExample(words: string) {
    setText(words);
    read(words);
  }

  const canSend = text.trim().length > 0;
  const details = entry
    ? [entry.category, entry.paidWith, entry.owes ? `${entry.owes.name} owes ${formatPaise(entry.owes.amount * 100)}` : null]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <View>
      <View className="flex-row items-end rounded-[28px] bg-surface p-1.5">
        <TextInput
          value={text}
          onChangeText={(value) => {
            setText(value);
            setHint(null);
          }}
          onSubmitEditing={() => canSend && read(text)}
          placeholder="Type what you spent, like “chai 40”"
          placeholderTextColor={colors.faint}
          returnKeyType="send"
          className="min-h-11 flex-1 px-3 py-2.5 text-base text-fg"
          style={{ fontFamily: fonts.regular }}
        />
        <Pressable
          onPress={() => read(text)}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send"
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: BRAND, opacity: canSend ? 1 : 0.3 }}
        >
          <ArrowUp size={22} color={WHITE} strokeWidth={2} />
        </Pressable>
      </View>

      <View className="mt-3 flex-row flex-wrap gap-2">
        {PRACTICE_EXAMPLES.map((words) => (
          <Pressable
            key={words}
            onPress={() => tryExample(words)}
            accessibilityRole="button"
            accessibilityHint="Tries this example"
            className="min-h-11 justify-center rounded-full border border-line px-4 active:bg-surface"
          >
            <Txt className="text-sm">{words}</Txt>
          </Pressable>
        ))}
      </View>

      {hint ? (
        <Txt tone="muted" className="mt-4 text-sm">
          {hint}
        </Txt>
      ) : null}

      {entry ? (
        <Animated.View key={round} entering={FadeInDown.duration(350)}>
          <View className="mt-5 rounded-3xl bg-surface p-4">
            <Txt weight="semibold" className="text-base">
              {saved ? "Saved" : "Look right?"}
            </Txt>
            <View className="mt-3 flex-row items-center gap-3">
              <CategoryBadge name={entry.category} size={40} />
              <View className="flex-1">
                <Txt weight="medium" className="text-base" numberOfLines={2}>
                  {entry.description}
                </Txt>
                <Txt tone="muted" className="mt-0.5 text-sm">
                  {details}
                </Txt>
              </View>
              <Txt weight="semibold" className="text-base">
                {formatPaise((entry.amount - (entry.owes?.amount ?? 0)) * 100)}
              </Txt>
            </View>
            {saved ? (
              <Animated.View entering={FadeInDown.duration(350)}>
                <View className="mt-4 flex-row items-center gap-3 rounded-2xl bg-accent-soft p-3">
                  <Coin size={32} variant="bare" mood="happy" />
                  <Txt weight="medium" className="flex-1 text-sm" style={{ lineHeight: 20 }}>
                    That&apos;s all there is to it. Finlyt worked out the amount, the category and how you paid.
                  </Txt>
                </View>
              </Animated.View>
            ) : (
              <Button
                label="Save"
                icon={Check}
                onPress={() => {
                  setSaved(true);
                  onDone();
                }}
                className="mt-4"
              />
            )}
          </View>
        </Animated.View>
      ) : null}
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
  const steps: Step[] = ["welcome", "try", "checkins", "import", "plan"];
  const { step: startAt } = useLocalSearchParams<{ step?: string }>();
  const [index, setIndex] = useState(() => Math.max(steps.indexOf(startAt as Step), 0));
  const [times, setTimes] = useState<ReminderTime[]>(DEFAULT_REMINDERS);
  const [review, setReview] = useState(prefs.reviewBeforeSave);
  const [practised, setPractised] = useState(false);
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
          <View className="-mx-2 mb-4">
            <CoinHero size={210} />
          </View>
        </In>
        <In i={1}>
          <Txt weight="medium" tone="accent" className="text-base">
            {firstName ? `Hi ${firstName}` : "Hi there"}
          </Txt>
        </In>
        <In i={2}>
          <View className="mt-1">
            <Title>Tracking money, as easy as texting a friend</Title>
          </View>
        </In>
        <In i={3}>
          <View className="mt-6">
            <Steps
              items={[
                {
                  icon: MessageSquareText,
                  title: "Tell Finlyt what you spent",
                  text: "Type or say it in your own words: “chai 40, auto 120 cash”.",
                },
                {
                  icon: Sparkles,
                  title: "Finlyt sorts it out",
                  text: "The amount, the category and how you paid. No forms to fill.",
                },
                {
                  icon: ChartColumn,
                  title: "See where your money goes",
                  text: "Today, this month, who owes you, and a daily limit to stay under.",
                },
              ]}
            />
          </View>
        </In>
      </>
    );
    actions = (
      <View>
        <Button label="Show me how" onPress={next} />
        <Txt tone="faint" className="mt-3 text-center text-xs">
          Takes about a minute
        </Txt>
      </View>
    );
  } else if (step === "try") {
    body = (
      <>
        <In i={0}>
          <Title>Try it once</Title>
        </In>
        <In i={1}>
          <Lead>Tap an example, or type something you bought today. This is practice, so nothing is saved.</Lead>
        </In>
        <In i={2}>
          <View className="mt-6">
            {/* A new key when the choice below changes, so the practice starts over with it. */}
            <Practice key={review ? "check" : "straight"} review={review} onDone={() => setPractised(true)} />
          </View>
        </In>
        <In i={3}>
          <View className="mt-6 rounded-3xl border border-line px-4 py-1">
            <SwitchRow
              title="Check before saving"
              description={
                review
                  ? "Finlyt shows what it understood and you tap Save. Change it any time in Settings."
                  : "Saved the moment you send it, with an Undo just in case. Change it any time in Settings."
              }
              value={review}
              onChange={setReview}
            />
          </View>
        </In>
      </>
    );
    actions = (
      <Button label={practised ? "Continue" : "Skip the practice"} variant={practised ? "primary" : "secondary"} onPress={next} />
    );
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
          <Lead>
            It&apos;s easy to forget what you spent. I&apos;ll remind you at these times. Tap one to change it, or add
            another.
          </Lead>
        </In>
        <In i={3}>
          <View className="mt-5">
            <ReminderEditor times={times} onChange={setTimes} />
          </View>
        </In>
      </>
    );
    actions = (
      <Button
        label="Turn on reminders"
        loading={busy}
        onPress={() => {
          // Asked here, where the reason is on the screen; saying no still moves on.
          setBusy(true);
          void ensureNotificationPermission()
            .catch(() => false)
            .finally(() => {
              setBusy(false);
              next();
            });
        }}
      />
    );
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
      <ScrollView key={step} className="flex-1" contentContainerClassName="px-6 pb-6 pt-5" keyboardShouldPersistTaps="handled">
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
