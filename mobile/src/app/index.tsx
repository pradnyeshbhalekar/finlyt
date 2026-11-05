// Home: today's check-in. Type (or say) what you spent at the bottom; Gemini turns it into
// entries that are saved straight away or shown for a quick check, per Settings.
import { router } from "expo-router";
import { ChevronRight, CircleAlert, Settings, Sparkles, Target, Undo2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, AppState, Pressable, RefreshControl, ScrollView, View } from "react-native";

import { Coin, HeaderLogo, type Mood } from "@/components/brand";
import { Composer } from "@/components/composer";
import { ExpenseRow } from "@/components/expense-row";
import { KeyboardAware } from "@/components/keyboard";
import { PlanStrip } from "@/components/plan-strip";
import { ProposalCard } from "@/components/proposal-card";
import { SmsPermissionCard, ToLog } from "@/components/to-log";
import { Icon, IconButton, Screen, SectionLabel, Txt } from "@/components/ui";
import { isoDate, startOfMonth } from "@/lib/dates";
import {
  entryCount,
  hasIssues,
  isUndoable,
  looksLikeQuestion,
  matchedMessage,
  proposalToCommit,
  savedMessage,
} from "@/lib/log";
import { logDraft, useLogDraft } from "@/lib/log-draft";
import { formatPaise } from "@/lib/money";
import {
  currentCheckIn,
  DEFAULT_REMINDERS,
  getReminderTimes,
  type ReminderTime,
} from "@/lib/notifications";
import { usePrefs } from "@/lib/prefs";
import {
  useBalances,
  useCommitLog,
  useDeleteExpense,
  useExpenses,
  useMeta,
  usePendingTxns,
  usePlan,
  useProposeLog,
  useRefreshMoney,
  useResolveTxn,
  useStats,
} from "@/lib/queries";
import { askSmsPermission, smsPermitted, smsSupported, syncSms } from "@/lib/sms";
import { useTheme } from "@/lib/theme";
import type { Expense, Proposal } from "@/lib/types";

const EXAMPLES = [
  "lunch 450 with Rahul, he owes 200",
  "auto 120, paid 30 more in cash",
  "chai 40 cash",
  "dmart 1.2k groceries",
  "petrol 500, rapido 74",
];

export default function Home() {
  const { colors } = useTheme();
  const prefs = usePrefs();
  const { pending, saved, notice, text, txn } = useLogDraft();

  const now = new Date();
  const today = isoDate(now);
  const meta = useMeta();
  const day = useStats(today, today);
  const month = useStats(isoDate(startOfMonth(now)), today);
  const todays = useExpenses({ from: today, to: today, limit: 100 });
  const plan = usePlan();
  const txns = usePendingTxns();
  const resolveTxn = useResolveTxn();
  const propose = useProposeLog();
  const commit = useCommitLog();
  const remove = useDeleteExpense();
  const balances = useBalances();
  const refreshMoney = useRefreshMoney();

  const [reminders, setReminders] = useState<ReminderTime[]>(DEFAULT_REMINDERS);
  const [example] = useState(() => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]);
  useEffect(() => {
    void getReminderTimes().then(setReminders);
  }, []);

  // Bank SMS: ask once, then pick up new payments whenever Home opens or the app comes back.
  const [smsAllowed, setSmsAllowed] = useState(smsPermitted);
  const [smsAsked, setSmsAsked] = useState(false);
  const filters = meta.data?.sms_filters;
  useEffect(() => {
    if (!smsAllowed || !filters) return;
    const run = () =>
      void syncSms(filters)
        .then(async ({ matched }) => {
          if (matched.length === 0) {
            await txns.refetch();
            return;
          }
          logDraft.saved({ message: matchedMessage(matched), expenseIds: [], input: "", questions: [], undoable: false });
          await refreshMoney();
        })
        .catch((e: Error) => console.warn("[sms] sync failed", e));
    run();
    const sub = AppState.addEventListener("change", (state) => state === "active" && run());
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smsAllowed, filters]);

  async function allowSms() {
    setSmsAsked(true);
    setSmsAllowed(await askSmsPermission());
  }

  // The "Saved" toast goes away on its own.
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => logDraft.clearSaved(), 8000);
    return () => clearTimeout(timer);
  }, [saved]);

  const accounts = new Map((meta.data?.accounts ?? []).map((a) => [a.id, a]));
  // Help the speech recognizer with names it wouldn't guess: accounts, people, common places.
  const hints = [
    ...(meta.data?.accounts ?? []).map((a) => a.name),
    ...(meta.data?.people ?? []).map((p) => p.name),
    "UPI", "GPay", "cash", "Zomato", "Swiggy", "Rapido", "DMart", "Blinkit", "Zepto", "chai",
  ];
  const categories = new Map((meta.data?.categories ?? []).map((c) => [c.id, c]));
  const items = todays.data?.items ?? [];
  const owed = month.data?.open_dues_paise ?? 0;

  const iOwe = (balances.data?.i_owe ?? []).reduce((sum, r) => sum + r.amount_paise, 0);
  const hour = now.getHours();
  const restingMood: Mood = hour >= 22 || hour < 6 ? "sleepy" : "default";

  async function save(proposal: Proposal, words: string) {
    const body = proposalToCommit(proposal, words.slice(0, 4000) || null);
    const result = await commit.mutateAsync(body);
    logDraft.saved({
      message: savedMessage(body),
      expenseIds: result.expense_ids,
      input: words,
      questions: proposal.questions,
      undoable: isUndoable(body),
    });
  }

  async function send() {
    const draft = logDraft;
    const { text: typed, note } = logDraft.get();
    const input = typed.trim();
    if (!input && !note) return;
    // A question about your money ("where did it all go?") goes to Ask, not the log.
    if (!note && looksLikeQuestion(input)) {
      draft.setText("");
      router.push({ pathname: "/ask", params: { q: input } });
      return;
    }
    draft.notice(null);
    try {
      const picked = logDraft.get().txn;
      const proposal = await propose.mutateAsync({
        text: input,
        audioUri: note?.uri ?? null,
        txnIds: picked ? [picked.id] : undefined,
      });
      if (entryCount(proposal) === 0) {
        draft.notice(
          proposal.questions[0] ?? "I couldn't find any spending in that. Add an amount, like “chai 40”.",
        );
        return;
      }
      const words = proposal.transcript || input;
      if (prefs.reviewBeforeSave || hasIssues(proposal)) {
        draft.hold({ proposal, input: words });
        return;
      }
      await save(proposal, words);
    } catch (e) {
      draft.notice((e as Error).message);
    }
  }

  async function savePending() {
    if (!pending) return;
    try {
      await save(pending.proposal, pending.input);
    } catch (e) {
      logDraft.notice((e as Error).message);
    }
  }

  async function undo() {
    if (!saved) return;
    try {
      await Promise.all(saved.expenseIds.map((id) => remove.mutateAsync(id)));
      logDraft.undone();
    } catch (e) {
      logDraft.notice((e as Error).message);
    }
  }

  function confirmDelete(expense: Expense) {
    Alert.alert("Delete this entry?", `${expense.description} · ${formatPaise(expense.my_share_paise)}`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate(expense.id) },
    ]);
  }

  function refresh() {
    void Promise.all([day.refetch(), month.refetch(), todays.refetch(), meta.refetch(), plan.refetch()]);
    if (smsAllowed && filters) void syncSms(filters).finally(() => txns.refetch());
    else void txns.refetch();
  }

  const busy = propose.isPending;
  // The logo's coin reacts: thinking while Gemini reads, happy for a few seconds after a save.
  const headerMood: Mood = busy || commit.isPending ? "thinking" : saved ? "happy" : restingMood;
  const showHint = !text && !pending && !saved && !notice && !busy;
  const toLog = txns.data?.items ?? [];

  return (
    <Screen>
      <View className="flex-1">
        <View className="flex-row items-center justify-between pl-5 pr-3 pt-2">
          <HeaderLogo height={30} mood={headerMood} splashTarget />
          <View className="flex-row">
            <IconButton icon={Sparkles} label="Ask Finlyt" onPress={() => router.push("/ask")} />
            <IconButton icon={Target} label="Plan" onPress={() => router.push("/plan")} />
            <IconButton icon={Settings} label="Settings" onPress={() => router.push("/settings")} />
          </View>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 pb-6"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={todays.isRefetching} onRefresh={refresh} tintColor={colors.muted} />
          }
        >
          <Txt tone="muted" className="mt-6 text-sm">
            {currentCheckIn(reminders, now) ?? "Today"}
          </Txt>
          <View className="mt-1 flex-row items-end justify-between">
            <Txt weight="bold" className="text-5xl" style={{ letterSpacing: -1 }}>
              {formatPaise(day.data?.spend_paise ?? 0)}
            </Txt>
            <Txt tone="muted" className="mb-2 text-sm">
              {toLog.length > 0 ? `${toLog.length} to log` : `${items.length} logged`}
            </Txt>
          </View>
          <View className="mt-1 flex-row flex-wrap">
            <Pressable onPress={() => router.push("/history")} hitSlop={6}>
              <Txt tone="muted" className="text-sm">
                {formatPaise(month.data?.spend_paise ?? 0)}
                {plan.data?.budget_paise ? ` of ${formatPaise(plan.data.budget_paise)}` : ""} this month
              </Txt>
            </Pressable>
            {owed > 0 ? (
              <Pressable onPress={() => router.push("/owed")} hitSlop={6}>
                <Txt tone="accent" className="text-sm">
                  {"  ·  "}
                  {formatPaise(owed)} owed to you
                </Txt>
              </Pressable>
            ) : null}
            {iOwe > 0 ? (
              <Pressable onPress={() => router.push("/owed")} hitSlop={6}>
                <Txt tone="muted" className="text-sm">
                  {"  ·  "}
                  you owe {formatPaise(iOwe)}
                </Txt>
              </Pressable>
            ) : null}
          </View>

          <PlanStrip status={plan.data} />

          {busy ? (
            <View className="mt-6 flex-row items-center gap-3 rounded-3xl bg-surface p-4">
              <Coin size={36} mood="thinking" variant="bare" />
              <Txt tone="muted">Reading that…</Txt>
            </View>
          ) : null}

          {pending && !busy ? (
            <View className="mt-6">
              <ProposalCard
                proposal={pending.proposal}
                accounts={accounts}
                categories={categories}
                saving={commit.isPending}
                onSave={() => void savePending()}
                onEdit={() => router.push("/log/review")}
                onDiscard={logDraft.discard}
              />
            </View>
          ) : null}

          {smsSupported() && !smsAllowed && !smsAsked ? (
            <SmsPermissionCard onAllow={() => void allowSms()} onDismiss={() => setSmsAsked(true)} />
          ) : null}

          <ToLog
            txns={toLog}
            accounts={accounts}
            selectedId={txn?.id ?? null}
            onSelect={logDraft.selectTxn}
            onResolve={(t, status) => {
              if (txn?.id === t.id) logDraft.selectTxn(null);
              resolveTxn.mutate({ id: t.id, status });
            }}
          />

          <View className="mt-8 flex-row items-center justify-between">
            <SectionLabel>Today</SectionLabel>
          </View>
          <View className="-mx-3 mt-2">
            {items.map((e) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                accounts={accounts}
                categories={categories}
                onPress={() => router.push({ pathname: "/expense/[id]", params: { id: String(e.id) } })}
                onLongPress={() => confirmDelete(e)}
              />
            ))}
          </View>
          {items.length === 0 && !todays.isLoading ? (
            <View className="mt-6 items-center">
              <Coin size={56} mood={restingMood} variant="bare" />
              <Txt tone="muted" className="mt-3 text-center">
                Nothing logged yet today.
              </Txt>
            </View>
          ) : null}

          <Pressable
            onPress={() => router.push("/history")}
            className="mt-4 flex-row items-center justify-between rounded-2xl py-3 active:opacity-60"
          >
            <Txt weight="medium" tone="muted">
              All history
            </Txt>
            <Icon icon={ChevronRight} size={18} tone="muted" />
          </Pressable>
        </ScrollView>

        <KeyboardAware>
          <View className="px-4 pt-2">
          {saved ? (
            <View className="mb-2 flex-row items-center gap-3 rounded-2xl bg-fg py-2 pl-4 pr-2">
              <Coin size={26} mood="happy" variant="bare" />
              <View className="flex-1">
                <Txt weight="medium" tone="inverse">
                  {saved.message}
                </Txt>
                {saved.questions[0] ? (
                  <Txt tone="inverse" className="text-xs opacity-70" numberOfLines={2}>
                    {saved.questions[0]}
                  </Txt>
                ) : null}
              </View>
              {saved.undoable ? (
                <Pressable
                  onPress={() => void undo()}
                  className="h-10 flex-row items-center gap-1.5 rounded-full px-3"
                  accessibilityRole="button"
                >
                  <Undo2 size={16} color={colors.bg} strokeWidth={1.75} />
                  <Txt weight="semibold" tone="inverse">
                    Undo
                  </Txt>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {notice ? (
            <View className="mb-2 flex-row items-start gap-2 rounded-2xl bg-surface px-4 py-3">
              <Icon icon={CircleAlert} size={18} tone="muted" />
              <View className="flex-1">
                <Txt tone="muted" className="text-sm">
                  {notice}
                </Txt>
                <Pressable onPress={() => router.push("/expense/new")} hitSlop={6} className="mt-1 self-start">
                  <Txt weight="medium" tone="accent" className="text-sm">
                    Add it by hand instead
                  </Txt>
                </Pressable>
              </View>
            </View>
          ) : null}

          {showHint ? (
            <View className="mb-2 self-start rounded-full border border-line px-4 py-2">
              <Txt tone="muted" className="text-sm">
                Try: “{txn ? "groceries, paid 200 more in cash" : example}”
              </Txt>
            </View>
          ) : null}

          <Composer
            busy={busy}
            placeholder={txn ? `What was ${txn.name}?` : "What did you spend on?"}
            hints={hints}
            onSend={() => void send()}
            onError={(message) => logDraft.notice(message)}
          />
          </View>
        </KeyboardAware>
      </View>
    </Screen>
  );
}
