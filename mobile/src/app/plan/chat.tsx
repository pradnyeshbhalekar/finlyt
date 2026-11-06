// The weekly check-in, on the day you chose: a short chat with Finlyt about the week ahead.
// When Finlyt asks something it offers answers to tap (or you type your own). It ends in a plan
// (monthly budget, bigger planned spends, a usual-day limit and optional bigger days) whose
// numbers you can change before confirming.
import { router } from "expo-router";
import { ArrowUp, Check, Mic, Minus, Plus, Square } from "lucide-react-native";
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";

import { Coin, type Mood } from "@/components/brand";
import { CategoryBadge } from "@/components/category-icon";
import { Choices } from "@/components/choices";
import { MemoryUpdates } from "@/components/memory-updates";
import { KeyboardAware } from "@/components/keyboard";
import { Button, Icon, IconButton, Txt, type IconType } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { formatPaise } from "@/lib/money";
import { getCheckIn, WEEKDAYS } from "@/lib/notifications";
import { useMeta, usePlanChat, useSavePlan } from "@/lib/queries";
import { useDictation } from "@/lib/speech";
import { BRAND, fonts, useTheme, WHITE } from "@/lib/theme";
import type { Category, ChatMessage, MemoryUpdate, ProposedPlan } from "@/lib/types";

type Message = ChatMessage & { memory?: MemoryUpdate[] };

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

function RoundButton({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: IconType;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      className={`h-9 w-9 items-center justify-center rounded-full bg-surface active:opacity-70 ${disabled ? "opacity-40" : ""}`}
    >
      <Icon icon={icon} size={18} />
    </Pressable>
  );
}

/** A rupee amount with − and +, which you can also tap and type. Rounded to ₹10. */
function AmountStepper({
  label,
  hint,
  paise,
  min,
  step,
  onChange,
}: {
  label: string;
  hint?: string;
  paise: number;
  min: number;
  step: number;
  onChange: (paise: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft === null) return;
    const rupees = parseInt(draft.replace(/\D/g, ""), 10);
    setDraft(null);
    if (!Number.isNaN(rupees)) onChange(Math.max(min, Math.round(rupees / 10) * 1000));
  }
  return (
    <View className="flex-row items-center gap-2 py-2">
      <View className="flex-1">
        <Txt weight="medium">{label}</Txt>
        {hint ? (
          <Txt tone="muted" className="text-xs">
            {hint}
          </Txt>
        ) : null}
      </View>
      <RoundButton icon={Minus} label={`Less for ${label}`} onPress={() => onChange(Math.max(min, paise - step))} disabled={paise - step < min} />
      <View className="w-24 flex-row items-center justify-center">
        <Txt weight="semibold" className="text-lg">
          ₹
        </Txt>
        <TextInput
          value={draft ?? String(Math.round(paise / 100))}
          onChangeText={setDraft}
          onEndEditing={commit}
          onBlur={commit}
          keyboardType="number-pad"
          selectTextOnFocus
          accessibilityLabel={label}
          className="min-w-10 py-0 text-center text-lg text-fg"
          style={{ fontFamily: fonts.semibold }}
        />
      </View>
      <RoundButton icon={Plus} label={`More for ${label}`} onPress={() => onChange(paise + step)} />
    </View>
  );
}

function CountStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View className="flex-row items-center gap-2 py-2">
      <View className="flex-1">
        <Txt weight="medium">Bigger days</Txt>
        <Txt tone="muted" className="text-xs">
          a week, for the days that cost more
        </Txt>
      </View>
      <RoundButton icon={Minus} label="Fewer bigger days" onPress={() => onChange(Math.max(0, value - 1))} disabled={value === 0} />
      <View className="w-24 items-center">
        <Txt weight="semibold" className="text-lg">
          {value}
        </Txt>
      </View>
      <RoundButton icon={Plus} label="More bigger days" onPress={() => onChange(Math.min(6, value + 1))} disabled={value === 6} />
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
        <CountStepper value={bigDays} onChange={setBigDays} />
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

function explain(e: Error): string {
  if (e instanceof ApiError && e.status === 404) {
    return "Planning isn't switched on for your Finlyt server yet. It needs one more backend deploy.";
  }
  return e.message;
}

export default function PlanChat() {
  const { colors } = useTheme();
  const meta = useMeta();
  const chat = usePlanChat();
  const save = useSavePlan();
  const [messages, setMessages] = useState<Message[]>([]);
  const [plan, setPlan] = useState<ProposedPlan | null>(null);
  const [planRound, setPlanRound] = useState(0);
  const [options, setOptions] = useState<string[]>([]);
  const [checkInDay, setCheckInDay] = useState(6);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const opened = useRef(false);
  const dictation = useDictation(setInput, setError);

  const categories = new Map((meta.data?.categories ?? []).map((c) => [c.id, c]));
  const hints = [
    ...(meta.data?.categories ?? []).map((c) => c.name),
    ...(meta.data?.accounts ?? []).map((a) => a.name),
    "budget", "rent", "lakh", "trip", "EMI",
  ];

  function showTurn(turn: { plan: ProposedPlan | null; options?: string[] }) {
    setPlan(turn.plan);
    if (turn.plan) setPlanRound((r) => r + 1);
    setOptions(turn.options ?? []);
  }

  // Finlyt opens the check-in.
  function open() {
    setError(null);
    chat
      .mutateAsync([])
      .then((turn) => {
        setMessages([{ role: "finlyt", text: turn.reply, memory: turn.memory_updates }]);
        showTurn(turn);
      })
      .catch((e: Error) => setError(explain(e)));
  }
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    open();
    void getCheckIn().then((c) => setCheckInDay(c.weekday));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Send what's in the box, or a tapped answer. */
  async function send(answer?: string) {
    const text = (answer ?? input).trim();
    if (!text || chat.isPending) return;
    const next: Message[] = [...messages, { role: "user", text }];
    setMessages(next);
    if (answer === undefined) setInput("");
    setOptions([]);
    setError(null);
    try {
      const turn = await chat.mutateAsync(next);
      setMessages([...next, { role: "finlyt", text: turn.reply, memory: turn.memory_updates }]);
      showTurn(turn);
    } catch (e) {
      setError(explain(e as Error));
    }
  }

  async function use(chosen: ProposedPlan) {
    try {
      await save.mutateAsync(chosen);
      setSaved(true);
      setOptions([]);
      const limits =
        chosen.big_days_per_week > 0 && chosen.big_day_limit_paise
          ? `${formatPaise(chosen.daily_limit_paise)} on usual days, and up to ${chosen.big_days_per_week} bigger ${
              chosen.big_days_per_week === 1 ? "day" : "days"
            } a week at ${formatPaise(chosen.big_day_limit_paise)}`
          : `${formatPaise(chosen.daily_limit_paise)} a day`;
      setMessages((list) => [
        ...list,
        { role: "finlyt", text: `Done. ${limits} from today. See you on ${WEEKDAYS[checkInDay]}.` },
      ]);
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

  const canSend = input.trim().length > 0 && !chat.isPending && !dictation.listening;

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
        {chat.isPending ? (
          <FinlytSays mood="thinking">
            <ActivityIndicator color={colors.muted} />
          </FinlytSays>
        ) : null}
        {!chat.isPending && !saved ? (
          <Choices options={options} onPick={(answer) => void send(answer)} onOther={() => inputRef.current?.focus()} />
        ) : null}
        {plan && !saved && !chat.isPending ? (
          <PlanCard
            key={planRound}
            plan={plan}
            categories={categories}
            saving={save.isPending}
            onUse={(chosen) => void use(chosen)}
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
            {messages.length === 0 && !chat.isPending ? (
              <Button label="Try again" variant="secondary" onPress={open} className="mt-3 self-start" />
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
              onPress={() => void send()}
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
