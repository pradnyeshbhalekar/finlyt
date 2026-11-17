// The weekly check-in, on the day you chose: a short chat with Finlyt about the week ahead.
// When Finlyt asks something it offers answers to tap (or you type your own). It ends in a plan
// (monthly budget, bigger planned spends, a usual-day limit and optional bigger days) whose
// numbers you can change before confirming. The conversation lives in lib/plan-chat, so leaving
// the screen keeps it (and a slow reply can notify you); the header's button starts it over.
import { router, useNavigation } from "expo-router";
import { ArrowUp, Check, Mic, RotateCcw, Square } from "lucide-react-native";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";

import { Coin, type Mood } from "@/components/brand";
import { CategoryBadge } from "@/components/category-icon";
import { Choices } from "@/components/choices";
import { MemoryUpdates } from "@/components/memory-updates";
import { KeyboardAware } from "@/components/keyboard";
import { AmountStepper, CountStepper } from "@/components/steppers";
import { Button, IconButton, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatPaise } from "@/lib/money";
import { getCheckIn, WEEKDAYS } from "@/lib/notifications";
import { planChat, usePlanChatState } from "@/lib/plan-chat";
import { fetchHabitQuestion, useDecideHabit, useMeta, useSavePlan } from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";

import { SLOW_NOTE, useSlow } from "@/lib/reply-alert";
import { useDictation } from "@/lib/speech";
import { BRAND, fonts, useTheme, WHITE } from "@/lib/theme";
import type { Category, HabitDecision, ProposedPlan } from "@/lib/types";

/** What Finlyt says once you've answered the habit question. */
function habitReply(d: HabitDecision): string {
  if (d.status === "keep") return "Fair enough. I won't bring it up for a while.";
  if (d.status === "need") return "Noted: that's a need, not a habit.";
  if (d.status === "later") return "Sure, another time.";
  if (d.paise_per_week) return `Got it: ${formatPaise(d.paise_per_week)} a week. I'll say after logging if a week goes over.`;
  if (d.times_per_week === 0) return "Got it. If you log it again, I'll say so after saving.";
  return `Got it: at most ${d.times_per_week} a week. I'll say after logging if you go past it.`;
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function FinlytSays({ children, mood = "default" }: { children: ReactNode; mood?: Mood }) {
  return (
    <View className="mb-3 flex-row items-end gap-2 pr-10">
      <Coin size={28} variant="bare" mood={mood} />
      <View className="rounded-3xl rounded-bl-md bg-surface px-4 py-3">{children}</View>
    </View>
  );
}

function YouSay({ text }: { text: string }) {
  return (
    <View className="mb-3 self-end rounded-3xl rounded-br-md px-4 py-3" style={{ backgroundColor: BRAND, maxWidth: "82%" }}>
      <Txt tone="onBrand" className="text-base leading-6">
        {text}
      </Txt>
    </View>
  );
}

/** Finlyt's plan, with the limits yours to change before you use it. */
function PlanCard({
  plan,
  categories,
  saving,
  onUse,
}: {
  plan: ProposedPlan;
  categories: Map<number, Category>;
  saving: boolean;
  onUse: (plan: ProposedPlan) => void;
}) {
  const month = new Date().toLocaleDateString("en-IN", { month: "long" });
  // The parent remounts the card (new key) when Finlyt proposes a new plan, so these seed once.
  const [daily, setDaily] = useState(plan.daily_limit_paise);
  const [bigDays, setBigDays] = useState(plan.big_days_per_week);
  const [big, setBig] = useState(plan.big_day_limit_paise ?? Math.max(plan.daily_limit_paise * 2, plan.daily_limit_paise + 10000));

  function changeDaily(paise: number) {
    setDaily(paise);
    if (big <= paise) setBig(paise + 5000);
  }

  const extra = bigDays > 0 ? (big - daily) * bigDays : 0;
  const weekly = daily * 7 + extra;
  const projected = daily * plan.days_left + Math.floor((extra * plan.days_left) / 7);
  const spare = plan.available_paise - projected;

  return (
    <View className="mb-3 ml-9 rounded-3xl border border-line p-4">
      <Txt tone="muted" className="text-sm">
        {month} budget {formatPaise(plan.monthly_budget_paise)}
      </Txt>
      <View className="mt-2">
        <AmountStepper label="Usual day" hint="most of your days" paise={daily} min={1000} step={1000} onChange={changeDaily} />
        <CountStepper label="Bigger days" hint="a week, for the days that cost more" value={bigDays} max={6} onChange={setBigDays} />
        {bigDays > 0 ? (
          <AmountStepper label="Bigger day" hint="up to" paise={big} min={daily + 1000} step={5000} onChange={setBig} />
        ) : null}
      </View>
      <Txt weight="medium" tone={spare < 0 ? "warn" : "fg"} className="mt-3 text-sm leading-5">
        About {formatPaise(weekly)} a week.{" "}
        {spare >= 0
          ? `Fits the rest of ${month} with ${formatPaise(spare)} to spare.`
          : `That's ${formatPaise(-spare)} more than ${month}'s budget leaves.`}
      </Txt>
      <Txt tone="muted" className="mt-1 text-sm leading-5">
        {bigDays > 0
          ? `A day you go past ${formatPaise(daily)} counts as a bigger day while the week has one left. What you don't spend is kept aside for surprises.`
          : "For everyday spending until your next check-in. What you don't spend is kept aside for surprises."}
      </Txt>
      {plan.planned_items.length > 0 ? (
        <View className="mt-4 gap-3">
          {plan.planned_items.map((item, i) => (
            <View key={i} className="flex-row items-center gap-3">
              <CategoryBadge name={item.category_id != null ? categories.get(item.category_id)?.name : null} size={32} />
              <View className="flex-1">
                <Txt weight="medium">{item.description}</Txt>
                {item.due_on ? (
                  <Txt tone="muted" className="text-xs">
                    {shortDate(item.due_on)}
                  </Txt>
                ) : null}
              </View>
              <Txt weight="semibold">{formatPaise(item.amount_paise)}</Txt>
            </View>
          ))}
        </View>
      ) : null}
      {plan.issues.map((issue, i) => (
        <Txt key={i} tone="warn" className="mt-2 text-sm">
          {issue}
        </Txt>
      ))}
      <Button
        label="Use this plan"
        icon={Check}
        onPress={() =>
          onUse({
            ...plan,
            daily_limit_paise: daily,
            big_day_limit_paise: bigDays > 0 ? big : null,
            big_days_per_week: bigDays,
          })
        }
        loading={saving}
        className="mt-4"
      />
      <Txt tone="faint" className="mt-2 text-center text-xs">
        Change the numbers here, or keep chatting to change the plan.
      </Txt>
    </View>
  );
}

export default function PlanChat() {
  const { colors } = useTheme();
  const meta = useMeta();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const save = useSavePlan();
  const { messages, plan, planRound, options, pending, error: chatError, saved, habit } = usePlanChatState();
  const decideHabit = useDecideHabit();
  const slow = useSlow(pending);
  const [checkInDay, setCheckInDay] = useState(6);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [input, setInput] = useState("");
  const [localError, setError] = useState<string | null>(null);
  const error = localError ?? chatError;
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const dictation = useDictation(setInput, setError);

  const categories = new Map((meta.data?.categories ?? []).map((c) => [c.id, c]));
  const hints = [
    ...(meta.data?.categories ?? []).map((c) => c.name),
    ...(meta.data?.accounts ?? []).map((a) => a.name),
    "budget", "rent", "lakh", "trip", "EMI",
  ];

  // Pick up the chat where it was left, or let Finlyt open a new one. While this screen is open
  // the chat asks it whether it's being looked at, to decide if a reply needs a notification.
  const userId = user?.id ?? null;
  useEffect(() => {
    planChat.enter(userId);
    planChat.watch(() => navigation.isFocused());
    void getCheckIn().then((c) => setCheckInDay(c.weekday));
    return () => planChat.watch(null);
  }, [userId, navigation]);

  // Something Finlyt was told to remember shows up on the memory screen.
  const remembered = messages.reduce((n, m) => n + (m.memory?.length ?? 0), 0);
  useEffect(() => {
    if (remembered > 0) void queryClient.invalidateQueries({ queryKey: ["memory"] });
  }, [remembered, queryClient]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        messages.length > 1 && !saved ? (
          <IconButton
            icon={RotateCcw}
            label="Start over"
            tone="muted"
            onPress={() => {
              setError(null);
              planChat.startOver();
            }}
          />
        ) : null,
    });
  }, [navigation, messages.length, saved]);

  /** Send what's in the box, or a tapped answer. */
  function send(answer?: string) {
    const text = (answer ?? input).trim();
    if (!text || pending) return;
    if (answer === undefined) setInput("");
    setError(null);
    planChat.send(text);
  }

  async function use(chosen: ProposedPlan) {
    try {
      await save.mutateAsync(chosen);
      const limits =
        chosen.big_days_per_week > 0 && chosen.big_day_limit_paise
          ? `${formatPaise(chosen.daily_limit_paise)} on usual days, and up to ${chosen.big_days_per_week} bigger ${
              chosen.big_days_per_week === 1 ? "day" : "days"
            } a week at ${formatPaise(chosen.big_day_limit_paise)}`
          : `${formatPaise(chosen.daily_limit_paise)} a day`;
      planChat.finish(`Done. ${limits} from today. See you on ${WEEKDAYS[checkInDay]}.`);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    // Then one small habit worth a look, if there is one. An older server just doesn't ask.
    const question = await fetchHabitQuestion().catch(() => null);
    if (question) planChat.askHabit(question);
  }

  /** An answer to the habit question: saved as a decision straight away, no AI involved. */
  async function answerHabit(label: string) {
    const question = habit;
    const option = question?.options.find((o) => o.label === label);
    if (!question || !option) return;
    const decision: HabitDecision = {
      status: option.status,
      times_per_week: option.times_per_week,
      paise_per_week: option.paise_per_week,
      note: option.note,
    };
    try {
      const result = await decideHabit.mutateAsync({ key: question.key, ...decision });
      planChat.answeredHabit(label, habitReply(decision), result.update ? [result.update] : undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleMic() {
    if (dictation.listening) {
      dictation.stop();
      return;
    }
    const started = await dictation.start(input, hints);
    if (!started) setError("Voice input isn't available on this phone. You can type instead.");
  }

  const canSend = input.trim().length > 0 && !pending && !dictation.listening;

  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        ref={scroll}
        className="flex-1"
        contentContainerClassName="px-4 pb-4 pt-2"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((m, i) =>
          m.role === "finlyt" ? (
            <View key={i}>
              <FinlytSays mood={saved && i === messages.length - 1 ? "happy" : "default"}>
                <Txt className="text-base leading-6">{m.text}</Txt>
              </FinlytSays>
              <MemoryUpdates updates={m.memory} />
            </View>
          ) : (
            <YouSay key={i} text={m.text} />
          ),
        )}
        {pending ? (
          <FinlytSays mood="thinking">
            <ActivityIndicator color={colors.muted} />
            {slow ? (
              <Txt tone="muted" className="mt-2 text-sm">
                {SLOW_NOTE}
              </Txt>
            ) : null}
          </FinlytSays>
        ) : null}
        {!pending && !saved ? (
          <Choices options={options} onPick={(answer) => send(answer)} onOther={() => inputRef.current?.focus()} />
        ) : null}
        {plan && !saved && !pending ? (
          <PlanCard
            key={planRound}
            plan={plan}
            categories={categories}
            saving={save.isPending}
            onUse={(chosen) => void use(chosen)}
          />
        ) : null}
        {saved && habit ? (
          <Choices
            options={habit.options.map((o) => o.label)}
            onPick={(answer) => void answerHabit(answer)}
            disabled={decideHabit.isPending}
          />
        ) : null}
        {saved ? (
          <View className="ml-9 mt-1">
            <Button label="Back to Home" variant="secondary" onPress={() => router.back()} />
          </View>
        ) : null}
        {error ? (
          <View className="ml-9 mt-1">
            <Txt tone="danger" className="text-sm">
              {error}
            </Txt>
            {messages.length === 0 && !pending ? (
              <Button label="Try again" variant="secondary" onPress={planChat.retry} className="mt-3 self-start" />
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {!saved ? (
        <KeyboardAware>
          <View className="mx-4 mt-2 flex-row items-end rounded-[28px] bg-surface p-1.5">
            <TextInput
              ref={inputRef}
              value={input}
              onChangeText={setInput}
              placeholder={dictation.listening ? "Listening…" : options.length ? "Or type your own answer" : "Tell Finlyt about your week"}
              placeholderTextColor={colors.faint}
              multiline
              editable={!dictation.listening}
              className="max-h-32 min-h-11 flex-1 px-3 py-2.5 text-base text-fg"
              style={{ fontFamily: fonts.regular }}
            />
            <IconButton
              icon={dictation.listening ? Square : Mic}
              label={dictation.listening ? "Stop" : "Talk"}
              onPress={() => void toggleMic()}
              tone={dictation.listening ? "danger" : "muted"}
            />
            <Pressable
              onPress={() => send()}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Send"
              className="h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: BRAND, opacity: canSend ? 1 : 0.3 }}
            >
              <ArrowUp size={22} color={WHITE} strokeWidth={2} />
            </Pressable>
          </View>
        </KeyboardAware>
      ) : null}
    </View>
  );
}
