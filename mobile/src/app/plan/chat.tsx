// The Sunday check-in: a short chat with Finlyt about the week ahead, ending in a plan
// (monthly budget, bigger planned spends, a daily limit) that you confirm with one tap.
import { router } from "expo-router";
import { ArrowUp, Check, Mic, Square } from "lucide-react-native";
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";

import { Coin, type Mood } from "@/components/brand";
import { CategoryBadge } from "@/components/category-icon";
import { KeyboardAware } from "@/components/keyboard";
import { Button, IconButton, Txt } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { formatPaise } from "@/lib/money";
import { useMeta, usePlanChat, useSavePlan } from "@/lib/queries";
import { useDictation } from "@/lib/speech";
import { BRAND, fonts, useTheme, WHITE } from "@/lib/theme";
import type { Category, ChatMessage, ProposedPlan } from "@/lib/types";

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

function PlanCard({
  plan,
  categories,
  saving,
  onUse,
}: {
  plan: ProposedPlan;
  categories: Map<number, Category>;
  saving: boolean;
  onUse: () => void;
}) {
  const month = new Date().toLocaleDateString("en-IN", { month: "long" });
  return (
    <View className="mb-3 ml-9 rounded-3xl border border-line p-4">
      <Txt tone="muted" className="text-sm">
        {month} budget {formatPaise(plan.monthly_budget_paise)}
      </Txt>
      <View className="mt-1 flex-row items-baseline gap-2">
        <Txt weight="bold" className="text-4xl" style={{ letterSpacing: -0.5 }}>
          {formatPaise(plan.daily_limit_paise)}
        </Txt>
        <Txt tone="muted">a day</Txt>
      </View>
      <Txt tone="muted" className="mt-1 text-sm leading-5">
        For everyday spending until your next check-in. What you don&apos;t spend is kept aside for surprises.
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
      <Button label="Use this plan" icon={Check} onPress={onUse} loading={saving} className="mt-4" />
      <Txt tone="faint" className="mt-2 text-center text-xs">
        Or keep chatting to change it.
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [plan, setPlan] = useState<ProposedPlan | null>(null);
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

  // Finlyt opens the check-in.
  function open() {
    setError(null);
    chat
      .mutateAsync([])
      .then((turn) => {
        setMessages([{ role: "finlyt", text: turn.reply }]);
        setPlan(turn.plan);
      })
      .catch((e: Error) => setError(explain(e)));
  }
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || chat.isPending) return;
    const next: ChatMessage[] = [...messages, { role: "user", text }];
    setMessages(next);
    setInput("");
    setError(null);
    try {
      const turn = await chat.mutateAsync(next);
      setMessages([...next, { role: "finlyt", text: turn.reply }]);
      setPlan(turn.plan);
    } catch (e) {
      setError(explain(e as Error));
    }
  }

  async function use() {
    if (!plan) return;
    try {
      await save.mutateAsync(plan);
      setSaved(true);
      setMessages((list) => [
        ...list,
        {
          role: "finlyt",
          text: `Done. ${formatPaise(plan.daily_limit_paise)} a day from today. See you next Sunday.`,
        },
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
            <FinlytSays key={i} mood={saved && i === messages.length - 1 ? "happy" : "default"}>
              <Txt className="text-base leading-6">{m.text}</Txt>
            </FinlytSays>
          ) : (
            <YouSay key={i} text={m.text} />
          ),
        )}
        {chat.isPending ? (
          <FinlytSays mood="thinking">
            <ActivityIndicator color={colors.muted} />
          </FinlytSays>
        ) : null}
        {plan && !saved && !chat.isPending ? (
          <PlanCard plan={plan} categories={categories} saving={save.isPending} onUse={() => void use()} />
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
              value={input}
              onChangeText={setInput}
              placeholder={dictation.listening ? "Listening…" : "Tell Finlyt about your week"}
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
