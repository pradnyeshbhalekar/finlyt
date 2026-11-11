// Home: today's check-in. Type (or say) what you spent at the bottom; Gemini turns it into
// entries that are saved straight away or shown for a quick check, per Settings.
import { router, useLocalSearchParams } from "expo-router";
import { ChevronRight, CircleAlert, Undo2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { AppState, Pressable, RefreshControl, ScrollView, View } from "react-native";

import { AvatarButton } from "@/components/avatar";
import { Coin, HeaderLogo, type Mood } from "@/components/brand";
import { Composer } from "@/components/composer";
import { ExpenseRow } from "@/components/expense-row";
import { KeyboardAware } from "@/components/keyboard";
import { CheckInNudge, SummaryTiles, TodayHero } from "@/components/home-summary";
import { ProposalCard } from "@/components/proposal-card";
import { useTabBarHeight } from "@/components/tab-bar";
import { ToLog } from "@/components/to-log";
import { TourTarget } from "@/components/tour";
import { Icon, Screen, SectionLabel, Txt } from "@/components/ui";
import { isoDate, moveToDay, startOfMonth } from "@/lib/dates";
import {
  entryCount,
  hasIssues,
  isUndoable,
  looksLikeQuestion,
  proposalToCommit,
  savedMessage,
} from "@/lib/log";
import { logDraft, useLogDraft } from "@/lib/log-draft";
import { formatPaise } from "@/lib/money";
import { useAuth } from "@/lib/auth";
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
import { refreshWidgets, scheduleWidgetRefresh } from "@/widgets/refresh";
import { useTheme } from "@/lib/theme";
import type { Expense, Proposal } from "@/lib/types";
import { confirmDelete as askDelete } from "@/lib/ask-sheet";

const EXAMPLES = [
  "lunch 450 with Rahul, he owes 200",
  "auto 120, paid 30 more in cash",
  "chai 40 cash",
  "dmart 1.2k groceries",
  "petrol 500, rapido 74",
];

export default function Home() {
  const { colors } = useTheme();
  // From the "Log an expense" widget: finlyt:///?compose=type or ?compose=voice.
  const { compose } = useLocalSearchParams<{ compose?: string }>();
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

  // Keep home-screen widgets in step with what Home shows.
  useEffect(() => {
    scheduleWidgetRefresh();
  }, [day.dataUpdatedAt, plan.dataUpdatedAt, txns.dataUpdatedAt]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => state === "background" && void refreshWidgets());
    return () => sub.remove();
  }, []);

  const [example] = useState(() => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]);

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
  const { user } = useAuth();
  const tabBarHeight = useTabBarHeight();
  // At rest the coin is lively: its normal face, then a smile, over and over (see useLivelyMood).
  const restingMood: Mood = "default";

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
    askDelete("Delete this entry?", `${expense.description} · ${formatPaise(expense.my_share_paise)}`, () =>
      remove.mutate(expense.id),
    );
  }

  function refresh() {
    void Promise.all([day.refetch(), month.refetch(), todays.refetch(), meta.refetch(), plan.refetch()]);
    void refreshMoney(); // the month card and the rest
    void txns.refetch();
  }

  const busy = propose.isPending;
  // The logo's coin reacts: thinking while Gemini reads, happy for a few seconds after a save.
  const headerMood: Mood = busy || commit.isPending ? "thinking" : saved ? "happy" : restingMood;
  // The "Try: …" example only helps before anything's logged today.
  const showHint = !text && !pending && !saved && !notice && !busy && items.length === 0;
  const toLog = txns.data?.items ?? [];

  return (
    <Screen>
      <View className="flex-1">
        <View className="flex-row items-center justify-between pl-5 pr-3 pt-2">
          <HeaderLogo height={30} mood={headerMood} splashTarget />
          <TourTarget id="avatar">
            <AvatarButton user={user} onPress={() => router.push("/settings")} />
          </TourTarget>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 pb-6"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={todays.isRefetching} onRefresh={refresh} tintColor={colors.muted} />
          }
        >
          <TourTarget id="today">
            <TodayHero spentPaise={day.data?.spend_paise ?? 0} plan={plan.data} />
          </TourTarget>
          <TourTarget id="tiles">
            <SummaryTiles
              monthPaise={month.data?.spend_paise ?? 0}
              budgetPaise={plan.data?.budget_paise ?? null}
              owedToMePaise={owed}
              iOwePaise={iOwe}
            />
          </TourTarget>
          <CheckInNudge plan={plan.data} />

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
                onMoveDay={(dayIso) =>
                  logDraft.hold({
                    ...pending,
                    proposal: {
                      ...pending.proposal,
                      expenses: pending.proposal.expenses.map((e) =>
                        e.payments.some((p) => p.bank_txn_id) ? e : { ...e, occurred_at: moveToDay(e.occurred_at, dayIso) },
                      ),
                    },
                  })
                }
              />
            </View>
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

          <TourTarget id="logged" className="mt-8 flex-row items-center justify-between">
            <SectionLabel>Logged today</SectionLabel>
          </TourTarget>
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

        <KeyboardAware rest={10} offset={tabBarHeight}>
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

          <TourTarget id="composer">
          <Composer
            busy={busy}
            placeholder={txn ? `What was ${txn.name}?` : "What did you spend on?"}
            hints={hints}
            onSend={() => void send()}
            onError={(message) => logDraft.notice(message)}
            launch={compose === "voice" || compose === "type" ? compose : undefined}
            onLaunched={() => router.setParams({ compose: undefined })}
          />
          </TourTarget>
          </View>
        </KeyboardAware>
      </View>
    </Screen>
  );
}
