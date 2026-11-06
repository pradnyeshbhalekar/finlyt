// First run after signing in, one thing at a time: what Finlyt does, check-in times, how to save
// what you tell it, bank SMS, importing from an AI chat, and the weekly planning check-in (day and
// time). The coin sits at the top of every step, and each step's pieces come in one after another.
import { router } from "expo-router";
import {
  Bell,
  CalendarClock,
  ChevronLeft,
  ClipboardPaste,
  Copy,
  CircleCheck,
  MessageSquareText,
  Mic,
  Target,
  Zap,
  type LucideIcon,
} from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Coin, type Mood } from "@/components/brand";
import { ReminderEditor } from "@/components/reminder-editor";
import { formatClock, TimePickerSheet } from "@/components/time-picker";
import { Button, Icon, IconButton, Row, Screen, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
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
import { askSmsPermission, smsPermitted, smsSupported } from "@/lib/sms";
import { BRAND } from "@/lib/theme";

type Step = "welcome" | "checkins" | "saving" | "sms" | "import" | "plan";

/** The coin at the top of each step, in a mood that suits it. */
const MOODS: Record<Step, Mood> = {
  welcome: "happy",
  checkins: "default",
  saving: "thinking",
  sms: "default",
  import: "happy",
  plan: "default",
};

/** Wraps a piece of a step so it slides in after the ones before it. */
function In({ i, children }: { i: number; children: ReactNode }) {
  return <Animated.View entering={FadeInDown.delay(120 * i + 60).duration(450)}>{children}</Animated.View>;
}

function Title({ children }: { children: ReactNode }) {
  return (
    <Txt weight="bold" className="text-3xl" style={{ letterSpacing: -0.6, lineHeight: 38 }}>
      {children}
    </Txt>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return (
    <Txt tone="muted" className="mt-3 text-base" style={{ lineHeight: 24 }}>
      {children}
    </Txt>
  );
}

function Feature({ icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <View className="flex-row gap-4 py-3">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-surface">
        <Icon icon={icon} size={19} tone="accent" />
      </View>
      <View className="flex-1">
        <Txt weight="semibold" className="text-base">
          {title}
        </Txt>
        <Txt tone="muted" className="mt-0.5 text-sm" style={{ lineHeight: 20 }}>
          {text}
        </Txt>
      </View>
    </View>
  );
}

function Choice({
  icon,
  title,
  text,
  selected,
  onPress,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={`mb-3 flex-row gap-4 rounded-3xl p-4 ${selected ? "bg-accent-soft" : "bg-surface"}`}
      style={{ borderWidth: 2, borderColor: selected ? BRAND : "transparent" }}
    >
      <Icon icon={icon} size={22} tone={selected ? "accent" : "muted"} />
      <View className="flex-1">
        <Txt weight="semibold" className="text-base">
          {title}
        </Txt>
        <Txt tone="muted" className="mt-1 text-sm" style={{ lineHeight: 20 }}>
          {text}
        </Txt>
      </View>
    </Pressable>
  );
}

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const prefs = usePrefs();
  const { user } = useAuth();
  const steps: Step[] = [
    "welcome",
    "checkins",
    "saving",
    ...(smsSupported() ? (["sms"] as Step[]) : []),
    "import",
    "plan",
  ];
  const [index, setIndex] = useState(0);
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
      prefs.update({ reviewBeforeSave: review, onboarded: true }); // switches the app to Home
      if (thenPlan) setTimeout(() => router.push("/plan/chat"), 400);
    }
  }

  async function allowSms() {
    if (!smsPermitted()) await askSmsPermission();
    next();
  }

  let body: ReactNode;
  let actions: ReactNode;
  if (step === "welcome") {
    body = (
      <>
        <In i={1}>
          <Txt tone="muted" className="text-base">
            {firstName ? `Hi ${firstName}` : "Hi"}
          </Txt>
        </In>
        <In i={2}>
          <Title>Never forget an expense again.</Title>
        </In>
        <View className="mt-6">
          <In i={3}>
            <Feature icon={Bell} title="Reminders you pick" text="A nudge at lunch, evening and night to log what you spent." />
          </In>
          <In i={4}>
            <Feature icon={Mic} title="Plain words" text="Type or say “chai 40 cash, auto 120” and it's sorted." />
          </In>
          <In i={5}>
            <Feature icon={MessageSquareText} title="Payments found for you" text="Your bank's UPI SMS show up, ready to explain." />
          </In>
          <In i={6}>
            <Feature icon={Target} title="A daily limit" text="A short chat on Sundays turns your budget into a daily number." />
          </In>
        </View>
      </>
    );
    actions = <Button label="Get started" onPress={next} />;
  } else if (step === "checkins") {
    body = (
      <>
        <In i={1}>
          <Title>When should I check in?</Title>
        </In>
        <In i={2}>
          <Lead>I&apos;ll remind you at these times. Tap one to change it.</Lead>
        </In>
        <In i={3}>
          <View className="mt-6">
            <ReminderEditor times={times} onChange={setTimes} />
          </View>
        </In>
      </>
    );
    actions = <Button label="Continue" onPress={next} />;
  } else if (step === "saving") {
    body = (
      <>
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
            />
          </In>
          <In i={4}>
            <Choice
              icon={Zap}
              title="Save straight away"
              text="Saved the moment you send it, with an Undo just in case."
              selected={!review}
              onPress={() => setReview(false)}
            />
          </In>
        </View>
      </>
    );
    actions = <Button label="Continue" onPress={next} />;
  } else if (step === "sms") {
    body = (
      <>
        <In i={1}>
          <Title>Pick up bank payments?</Title>
        </In>
        <In i={2}>
          <Lead>
            I can read your Kotak and DNS Bank SMS and list each UPI payment for you to explain. Other messages
            never leave your phone.
          </Lead>
        </In>
        <In i={3}>
          <View className="mt-8 rounded-3xl bg-surface px-4 py-3.5">
            <View className="flex-row items-center">
              <View className="flex-1">
                <Txt weight="medium" className="text-base">
                  Zomato
                </Txt>
                <Txt tone="muted" className="text-sm">
                  1:12 PM · UPI · Kotak
                </Txt>
              </View>
              <Txt weight="semibold" className="text-base">
                ₹450
              </Txt>
              <View className="ml-3 h-2 w-2 rounded-full bg-brand" />
            </View>
          </View>
        </In>
        <In i={4}>
          <View className="mt-3 self-start rounded-full border border-line px-4 py-2">
            <Txt tone="muted" className="text-sm">
              What was Zomato? “lunch with Rahul, he owes 200”
            </Txt>
          </View>
        </In>
      </>
    );
    actions = (
      <View className="flex-row gap-3">
        <Button label="Not now" variant="secondary" onPress={next} className="flex-1" />
        <Button label="Allow" onPress={() => void allowSms()} className="flex-1" />
      </View>
    );
  } else if (step === "import") {
    body = (
      <>
        <In i={1}>
          <Title>Tracked spending with an AI?</Title>
        </In>
        <In i={2}>
          <Lead>
            If you&apos;ve been telling Claude, ChatGPT or Gemini what you spent, Finlyt can bring it all in, splits
            and paybacks included. Your weekly check-ins get better with it.
          </Lead>
        </In>
        <View className="mt-6">
          <In i={3}>
            <Feature icon={Copy} title="Copy a prompt" text="Finlyt writes it with your categories and accounts." />
          </In>
          <In i={4}>
            <Feature icon={MessageSquareText} title="Paste it into that chat" text="The same conversation where you tracked your spending." />
          </In>
          <In i={5}>
            <Feature icon={ClipboardPaste} title="Paste the reply back" text="Check the list, untick anything, and import. One tap undoes it." />
          </In>
        </View>
      </>
    );
    actions = (
      <View className="flex-row gap-3">
        <Button label="Not now" variant="secondary" onPress={next} className="flex-1" />
        <Button
          label="Import"
          onPress={() => {
            next(); // coming back from the import lands on the next step
            router.push("/import");
          }}
          className="flex-1"
        />
      </View>
    );
  } else {
    body = (
      <>
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
          <View className="-mx-3 mt-6">
            <Row
              onPress={() => {
                setPickRound((r) => r + 1);
                setPickingCheckIn(true);
              }}
              leading={<Icon icon={CalendarClock} size={20} tone="accent" />}
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
      <View className="h-12 flex-row items-center px-2">
        {index > 0 ? (
          <IconButton icon={ChevronLeft} label="Back" onPress={() => setIndex(index - 1)} tone="muted" />
        ) : (
          <View className="w-11" />
        )}
        <View className="flex-1 flex-row justify-center gap-1.5">
          {steps.map((s, i) => (
            <View
              key={s}
              className={`h-1.5 rounded-full ${i <= index ? "bg-brand" : "bg-line"}`}
              style={{ width: i === index ? 22 : 8 }}
            />
          ))}
        </View>
        <View className="w-11" />
      </View>
      {/* A new key per step replays the entrance animations. */}
      <ScrollView key={step} className="flex-1" contentContainerClassName="px-6 pb-6 pt-6">
        <In i={0}>
          <View className="mb-7">
            <Coin size={56} variant="bare" mood={MOODS[step]} />
          </View>
        </In>
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
