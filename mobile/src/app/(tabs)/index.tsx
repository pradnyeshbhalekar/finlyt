// Home: today's check-in. Type (or say) what you spent at the bottom, or tap + to fill in a form,
// scan a receipt or paste a bank SMS; Gemini (or rules, for simple notes and bank SMS) turns
// words into entries that are saved straight away or shown for a quick check, per Settings.
// Examples above the box can be tapped to try them. Before anything has ever been logged, a card
// explains the three ways to log. People who already use Finlyt see the tour once after an
// update that changes it (prefs.tourVersion).
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronRight, CircleAlert, RefreshCw, Undo2 } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, RefreshControl, ScrollView, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";

import { AddSheet } from "@/components/add-sheet";
import { AvatarButton } from "@/components/avatar";
import { Coin, HeaderLogo, type Mood } from "@/components/brand";
import { Composer } from "@/components/composer";
import { ExpenseRow } from "@/components/expense-row";
import { FirstSteps } from "@/components/first-steps";
import { KeyboardAware } from "@/components/keyboard";
import { CheckInNudge, SummaryTiles, TodayHero } from "@/components/home-summary";
import { ProposalCard } from "@/components/proposal-card";
import { ReadingCard } from "@/components/reading-card";
import { useTabBarHeight } from "@/components/tab-bar";
import { ToLog } from "@/components/to-log";
import { TourTarget } from "@/components/tour";
import { Icon, Screen, SectionLabel, Txt } from "@/components/ui";
import { useAppUpdate } from "@/lib/app-updates";
import { isoDate, moveToDay, startOfMonth } from "@/lib/dates";
import {
  entryCount,
  hasIssues,
  isUndoable,
  looksLikeBankSms,
  looksLikeQuestion,
  proposalToCommit,
  savedMessage,
} from "@/lib/log";
import { logDraft, useLogDraft } from "@/lib/log-draft";
import { formatPaise } from "@/lib/money";
import { useAuth } from "@/lib/auth";
import { receiptDraft } from "@/lib/receipt-draft";
import { useReplyAlert, useSlow } from "@/lib/reply-alert";
import { pickAlert } from "@/lib/habits";
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
import { useSplashPlaying } from "@/lib/splash-store";
import { tour, TOUR_VERSION } from "@/lib/tour";
import { refreshWidgets, scheduleWidgetRefresh } from "@/widgets/refresh";
import { useTheme } from "@/lib/theme";
import type { Expense, Proposal } from "@/lib/types";
import { confirmDelete as askDelete } from "@/lib/ask-sheet";

/** Shown above the box until something's logged today; tapping one puts it in the box. */
const EXAMPLES = ["chai 40", "auto 120 cash", "groceries 850", "lunch 450 with Rahul, he owes 200"];

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
  const latest = useExpenses({ limit: 1 }); // has anything ever been logged?
  const plan = usePlan();
  const txns = usePendingTxns();
  const resolveTxn = useResolveTxn();
  const propose = useProposeLog();
  const commit = useCommitLog();
  const remove = useDeleteExpense();
  const balances = useBalances();
  const refreshMoney = useRefreshMoney();
  // If reading a note takes a while and you've gone elsewhere, a notification brings you back.
  const alertAway = useReplyAlert("/");
  // The + in the box: a form, a receipt or a bank SMS.
  const [adding, setAdding] = useState(false);
  // A new version downloaded over the air: offer a restart instead of waiting for the next launch.
  const update = useAppUpdate();

  // Keep home-screen widgets in step with what Home shows.
  useEffect(() => {
    scheduleWidgetRefresh();
  }, [day.dataUpdatedAt, plan.dataUpdatedAt, txns.dataUpdatedAt]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => state === "background" && void refreshWidgets());
    return () => sub.remove();
  }, []);


  // A line about a small habit, if what was saved touched one (per Settings → Habit alerts).
  const habitLine = saved ? pickAlert(saved.habits, prefs.habitAlerts) : null;

  // The "Saved" toast goes away on its own, a little later when it has a habit to mention.
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => logDraft.clearSaved(), habitLine ? 10000 : 8000);
    return () => clearTimeout(timer);
  }, [saved, habitLine]);

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
      habits: result.habits,
    });
  }

  async function send() {
    const draft = logDraft;
    const { text: typed, note } = logDraft.get();
    const input = typed.trim();
    if (!input && !note) return;
    // A question about your money ("where did it all go?") goes to Ask, not the log. A pasted
    // bank SMS can end in "Not you?", so it never counts as one.
    if (!note && looksLikeQuestion(input) && !looksLikeBankSms(input)) {
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
      const count = entryCount(proposal);
      if (count === 0) {
        const question =
          proposal.questions[0] ?? "I couldn't find any spending in that. Add an amount, like “chai 40”.";
        // A bank SMS with nothing to log (money in, an ATM, an OTP) has nothing to fix either.
        if (proposal.model === "sms") draft.setText("");
        draft.notice(question);
        alertAway("Finlyt needs a bit more", question);
        return;
      }
      const words = proposal.transcript || input;
      const entries = count === 1 ? "1 entry" : `${count} entries`;
      if (prefs.reviewBeforeSave || hasIssues(proposal)) {
        draft.hold({ proposal, input: words });
        alertAway("Ready to check", `Finlyt read your note: ${entries}. Tap to check and save.`);
        return;
      }
      await save(proposal, words);
      alertAway("Saved", `Finlyt saved ${entries} from your note.`);
    } catch (e) {
      draft.notice((e as Error).message);
      alertAway("Finlyt couldn't read that", (e as Error).message);
    }
  }

  /** + → Paste a bank SMS: whatever was copied goes in the box and, if it's an SMS, is sent. */
  async function pasteSms() {
    let copied = "";
    try {
      copied = (await Clipboard.getStringAsync()).trim();
    } catch {
      // A blocked clipboard reads as empty.
    }
    if (!copied) {
      logDraft.notice("Copy the bank SMS first: in Messages, press and hold it and tap Copy. Then tap + again.");
      return;
    }
    logDraft.setText(copied.slice(0, 4000));
    if (!looksLikeBankSms(copied)) {
      logDraft.notice("That doesn't look like a bank SMS, so it's in the box to check first. Tap the arrow if it's right.");
      return;
    }
    await send();
  }

  /** + → Scan a receipt: Google's scanner, then the receipt screen asks who owes you. */
  async function scanReceipt() {
    const result = await receiptDraft.scan();
    if (result.error) logDraft.notice(result.error);
    else if (result.started) router.push("/receipt");
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
  const slow = useSlow(busy);
  // The logo's coin reacts: thinking while Gemini reads, happy for a few seconds after a save.
  const headerMood: Mood = busy || commit.isPending ? "thinking" : saved ? "happy" : restingMood;
  // The examples only help before anything's logged today.
  const showHint = !text && !pending && !saved && !notice && !busy && items.length === 0;
  const firstTime = latest.data !== undefined && latest.data.items.length === 0;
  // Before the first entry Home stays calm: today's total, the three ways to log and the box.
  // The month and owed tiles, the plan nudge and the history link come in once there's something
  // to show (and aren't flashed while we're still finding out).
  const calm = firstTime || latest.isLoading;

  /** Puts an example in the box and opens the keyboard, so it's one tap on the arrow to try it. */
  function tryExample(words: string) {
    logDraft.setText(words);
    router.setParams({ compose: "type" });
  }

  // People who already use Finlyt see the tour once after an update that changes it (new people
  // get it at the end of the welcome). Waits for the launch splash.
  const splashPlaying = useSplashPlaying();
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  });
  useEffect(() => {
    if (!prefs.loaded || prefs.tourVersion >= TOUR_VERSION || splashPlaying) return;
    const timer = setTimeout(() => {
      if (tour.get().active) return;
      prefsRef.current.update({ tourVersion: TOUR_VERSION });
      tour.start({ from: "update" });
    }, 1200);
    return () => clearTimeout(timer);
  }, [prefs.loaded, prefs.tourVersion, splashPlaying]);
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

        {update.pending ? (
          <Animated.View entering={FadeInDown.duration(260)} className="mx-5 mt-2 flex-row items-center gap-3 rounded-2xl bg-accent-soft py-2 pl-4 pr-2">
            <Icon icon={RefreshCw} size={16} tone="accent" />
            <Txt weight="medium" className="flex-1 text-sm">
              A new version of Finlyt is ready
            </Txt>
            <Pressable
              onPress={update.restart}
              accessibilityRole="button"
              className="h-10 justify-center rounded-full px-3 active:opacity-60"
            >
              <Txt weight="semibold" tone="accent">
                Restart
              </Txt>
            </Pressable>
          </Animated.View>
        ) : null}

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
          {calm ? null : (
            <>
              <TourTarget id="tiles">
                <SummaryTiles
                  monthPaise={month.data?.spend_paise ?? 0}
                  budgetPaise={plan.data?.budget_paise ?? null}
                  owedToMePaise={owed}
                  iOwePaise={iOwe}
                />
              </TourTarget>
              <CheckInNudge plan={plan.data} />
            </>
          )}

          {busy ? <ReadingCard slow={slow} /> : null}

          {/* The answer slides in where "Reading that…" was. */}
          {pending && !busy ? (
            <Animated.View entering={FadeInDown.springify().damping(18).stiffness(160)} exiting={FadeOut.duration(150)} className="mt-6">
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
            </Animated.View>
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

          {firstTime ? null : (
            <TourTarget id="logged" className="mt-8 flex-row items-center justify-between">
              <SectionLabel>Logged today</SectionLabel>
            </TourTarget>
          )}
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
            firstTime ? (
              <FirstSteps
                onType={() => router.setParams({ compose: "type" })}
                onSay={() => router.setParams({ compose: "voice" })}
                onScan={() => void scanReceipt()}
                onForm={() => router.push("/expense/new")}
              />
            ) : (
              <View className="mt-6 items-center">
                <Coin size={56} mood={restingMood} variant="bare" />
                <Txt tone="muted" className="mt-3 text-center">
                  Nothing logged yet today.
                </Txt>
                <Txt tone="faint" className="mt-1 text-center text-sm">
                  Type it in the box below or tap the mic. Tap + to scan a receipt, paste a bank SMS or fill in a form.
                </Txt>
              </View>
            )
          ) : null}

          {calm ? null : (
            <Pressable
              onPress={() => router.push("/history")}
              className="mt-4 flex-row items-center justify-between rounded-2xl py-3 active:opacity-60"
            >
              <Txt weight="medium" tone="muted">
                All history
              </Txt>
              <Icon icon={ChevronRight} size={18} tone="muted" />
            </Pressable>
          )}
        </ScrollView>

        <KeyboardAware rest={10} offset={tabBarHeight}>
          <View className="px-4 pt-2">
          {saved ? (
            <Animated.View
              entering={FadeInDown.springify().damping(18).stiffness(180)}
              exiting={FadeOut.duration(160)}
              className="mb-2 flex-row items-center gap-3 rounded-2xl bg-fg py-2 pl-4 pr-2"
            >
              <Coin size={26} mood={habitLine ? "thinking" : "happy"} variant="bare" />
              <View className="flex-1">
                <Txt weight="medium" tone="inverse">
                  {saved.message}
                </Txt>
                {habitLine ? (
                  <Txt tone="inverse" className="text-xs opacity-80" numberOfLines={2}>
                    {habitLine}
                  </Txt>
                ) : saved.questions[0] ? (
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
            </Animated.View>
          ) : null}

          {notice ? (
            <Animated.View entering={FadeIn.duration(200)} className="mb-2 flex-row items-start gap-2 rounded-2xl bg-surface px-4 py-3">
              <Icon icon={CircleAlert} size={18} tone="muted" />
              <View className="flex-1">
                <Txt tone="muted" className="text-sm">
                  {notice}
                </Txt>
                <Pressable onPress={() => router.push("/expense/new")} hitSlop={12} className="mt-1 self-start">
                  <Txt weight="medium" tone="accent" className="text-sm">
                    Add it by hand instead
                  </Txt>
                </Pressable>
              </View>
            </Animated.View>
          ) : null}

          {showHint ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              className="mb-2"
              style={{ flexGrow: 0 }}
              contentContainerClassName="items-center gap-2 pr-2"
            >
              <Txt tone="muted" className="text-sm">
                Try
              </Txt>
              {(txn ? ["groceries, paid 200 more in cash"] : EXAMPLES).map((words) => (
                <Pressable
                  key={words}
                  onPress={() => tryExample(words)}
                  accessibilityRole="button"
                  accessibilityHint="Puts this in the box"
                  className="min-h-11 justify-center rounded-full border border-line bg-bg px-4 active:bg-surface"
                >
                  <Txt className="text-sm">{words}</Txt>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <TourTarget id="composer">
          <Composer
            busy={busy}
            onAddByHand={() => setAdding(true)}
            placeholder={txn ? `What was ${txn.name}?` : "Type what you spent, like “chai 40”"}
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
      <AddSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onForm={() => router.push("/expense/new")}
        onScan={() => void scanReceipt()}
        onPasteSms={() => void pasteSms()}
      />
    </Screen>
  );
}
