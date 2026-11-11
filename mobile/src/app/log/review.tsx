// Edit Gemini's entries in detail before saving (from "Edit" on Home's check card).
import { router } from "expo-router";
import { CircleAlert, Plus, X } from "lucide-react-native";
import { useState, type ComponentProps } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Coin } from "@/components/brand";
import { KeyboardAware } from "@/components/keyboard";
import { categoryIcon } from "@/components/category-icon";
import { Button, Chip, Icon, SectionLabel, Toggle, Txt } from "@/components/ui";
import { dayLabel, isoDate, timeLabel } from "@/lib/dates";
import { isUndoable, savedMessage } from "@/lib/log";
import { logDraft, useLogDraft } from "@/lib/log-draft";
import { formatPaise, parseRupees } from "@/lib/money";
import { useCommitLog, useMeta } from "@/lib/queries";
import { fonts, useTheme } from "@/lib/theme";
import type { Account, Category, LogCommit, PendingTxn, ProposedExpense } from "@/lib/types";

type EditPayment = { account_id: number; bank_txn_id: number | null; txn_label: string | null; amount: string };
type EditDue = { name: string; amount: string };
type EditExpense = {
  include: boolean;
  description: string;
  category_id: number | null;
  occurred_at: string;
  payments: EditPayment[];
  dues: EditDue[];
  issues: string[];
};

/** 45000 → "450", 45050 → "450.50" (what goes in an amount field). */
function rupeeInput(paise: number): string {
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

function toEdit(e: ProposedExpense): EditExpense {
  return {
    include: true,
    description: e.description,
    category_id: e.category_id,
    occurred_at: e.occurred_at,
    payments: e.payments.map((p) => ({
      account_id: p.account_id,
      bank_txn_id: p.bank_txn_id,
      txn_label: p.txn_label,
      amount: rupeeInput(p.amount_paise),
    })),
    dues: e.dues.map((d) => ({ name: d.person_name, amount: rupeeInput(d.amount_paise) })),
    issues: e.issues,
  };
}

const sum = (values: (number | null)[]) => values.reduce<number>((t, v) => t + (v ?? 0), 0);

export default function Review() {
  const insets = useSafeAreaInsets();
  const { pending } = useLogDraft();
  const meta = useMeta();
  const commit = useCommitLog();
  const [expenses, setExpenses] = useState<EditExpense[]>(() => (pending?.proposal.expenses ?? []).map(toEdit));
  const [error, setError] = useState<string | null>(null);

  if (!pending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg p-8">
        <Coin size={56} mood="default" variant="bare" />
        <Txt tone="muted" className="mt-3 text-center">
          Nothing to check. Log something on Home first.
        </Txt>
      </View>
    );
  }
  const { proposal, input } = pending;
  const accounts = meta.data?.accounts ?? [];
  const categories = meta.data?.categories ?? [];
  const txns = new Map(proposal.txns.map((t) => [t.id, t]));

  function update(i: number, change: Partial<EditExpense>) {
    setExpenses((list) => list.map((e, j) => (j === i ? { ...e, ...change } : e)));
  }

  function build(): LogCommit | string {
    const body: LogCommit = {
      expenses: [],
      // Paybacks and transfer/ignore marks aren't edited here; they're saved as Gemini read them.
      settlements: proposal.settlements.map((s) => ({
        person_name: s.person_name,
        amount_paise: s.amount_paise,
        bank_txn_id: s.bank_txn_id,
      })),
      transfers: proposal.transfers.map((t) => t.bank_txn_id),
      ignored: proposal.ignored.map((t) => t.bank_txn_id),
      // Owing and paying back aren't edited here either.
      debts: (proposal.debts ?? []).map((d) => ({
        person_name: d.person_name,
        amount_paise: d.amount_paise,
        description: d.description,
        category_id: d.category_id,
        note_raw: input.slice(0, 4000) || null,
      })),
      repayments: (proposal.repayments ?? []).map((r) => ({
        person_name: r.person_name,
        amount_paise: r.amount_paise,
        bank_txn_id: r.bank_txn_id,
      })),
    };
    for (const e of expenses.filter((x) => x.include)) {
      const name = e.description.trim() || "this entry";
      if (!e.description.trim()) return "Every entry needs a description.";
      const payments = e.payments.map((p) => ({ ...p, paise: parseRupees(p.amount) }));
      if (payments.length === 0 || payments.some((p) => !p.paise)) return `Check the amounts for “${name}”.`;
      const dues = [];
      for (const d of e.dues) {
        if (!d.name.trim() && !d.amount.trim()) continue;
        const paise = parseRupees(d.amount);
        if (!d.name.trim() || !paise) return `Each person who owes you for “${name}” needs a name and amount.`;
        dues.push({ person_name: d.name.trim(), amount_paise: paise });
      }
      if (sum(dues.map((d) => d.amount_paise)) > sum(payments.map((p) => p.paise))) {
        return `People can't owe you more than you paid for “${name}”.`;
      }
      body.expenses.push({
        occurred_at: e.occurred_at,
        description: e.description.trim(),
        category_id: e.category_id,
        payments: payments.map((p) => ({ account_id: p.account_id, amount_paise: p.paise ?? 0, bank_txn_id: p.bank_txn_id })),
        dues,
        note_raw: input.slice(0, 4000) || null,
      });
    }
    const count =
      body.expenses.length +
      body.settlements.length +
      body.transfers.length +
      body.ignored.length +
      (body.debts?.length ?? 0) +
      (body.repayments?.length ?? 0);
    return count === 0 ? "Everything is switched off, so there's nothing to save." : body;
  }

  async function save() {
    const body = build();
    if (typeof body === "string") {
      setError(body);
      return;
    }
    setError(null);
    try {
      const result = await commit.mutateAsync(body);
      // Leave first so this screen doesn't re-render empty once the draft is cleared.
      router.back();
      logDraft.saved({
        message: savedMessage(body),
        expenseIds: result.expense_ids,
        input,
        questions: [],
        undoable: isUndoable(body),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const included = expenses.filter((e) => e.include).length;

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="px-5 pb-8" keyboardShouldPersistTaps="handled">
        {proposal.questions.map((q, i) => (
          <View key={i} className="mb-3 flex-row gap-2 rounded-2xl bg-surface p-3">
            <Icon icon={CircleAlert} size={18} tone="muted" />
            <Txt tone="muted" className="flex-1 text-sm">
              {q}
            </Txt>
          </View>
        ))}
        {expenses.map((e, i) => (
          <ExpenseEditor
            key={i}
            expense={e}
            accounts={accounts}
            categories={categories}
            txns={txns}
            onChange={(change) => update(i, change)}
          />
        ))}
        {error ? (
          <Txt tone="danger" className="mt-2 text-sm">
            {error}
          </Txt>
        ) : null}
      </ScrollView>
      <KeyboardAware rest={Math.max(insets.bottom, 16)}>
        <View className="px-5 pt-2">
          <Button
            label={included > 0 ? `Save ${included} ${included === 1 ? "entry" : "entries"}` : "Save"}
            onPress={() => void save()}
            loading={commit.isPending}
          />
        </View>
      </KeyboardAware>
    </View>
  );
}

function SmallInput(props: ComponentProps<typeof TextInput>) {
  const { colors } = useTheme();
  return (
    <TextInput
      placeholderTextColor={colors.faint}
      className="h-11 rounded-xl bg-surface px-3 text-base text-fg"
      style={{ fontFamily: fonts.regular }}
      {...props}
    />
  );
}

function txnSummary(t: PendingTxn | undefined): string {
  if (!t) return "";
  return `${formatPaise(t.amount_paise)}${t.counterparty ? ` to ${t.counterparty}` : ""}`;
}

function ExpenseEditor({
  expense: e,
  accounts,
  categories,
  txns,
  onChange,
}: {
  expense: EditExpense;
  accounts: Account[];
  categories: Category[];
  txns: Map<number, PendingTxn>;
  onChange: (change: Partial<EditExpense>) => void;
}) {
  const { colors } = useTheme();
  const total = sum(e.payments.map((p) => parseRupees(p.amount)));
  const owed = sum(e.dues.map((d) => parseRupees(d.amount)));
  const cash = accounts.find((a) => a.kind === "cash") ?? accounts[0];
  const accountName = (id: number) => accounts.find((a) => a.id === id)?.name ?? "Account";
  const setPayment = (i: number, change: Partial<EditPayment>) =>
    onChange({ payments: e.payments.map((p, j) => (j === i ? { ...p, ...change } : p)) });
  const setDue = (i: number, change: Partial<EditDue>) =>
    onChange({ dues: e.dues.map((d, j) => (j === i ? { ...d, ...change } : d)) });

  return (
    <View className={`mb-4 rounded-3xl bg-surface p-4 ${e.include ? "" : "opacity-50"}`}>
      <View className="flex-row items-center gap-3">
        <TextInput
          value={e.description}
          onChangeText={(description) => onChange({ description })}
          placeholder="What was it?"
          placeholderTextColor={colors.faint}
          className="flex-1 text-lg text-fg"
          style={{ fontFamily: fonts.semibold }}
        />
        <Toggle value={e.include} onChange={(include) => onChange({ include })} label="Save this entry" />
      </View>
      <Txt tone="muted" className="mt-1 text-sm">
        {dayLabel(isoDate(new Date(e.occurred_at)))}, {timeLabel(e.occurred_at)} · {formatPaise(total)}
        {owed > 0 ? ` · your share ${formatPaise(Math.max(total - owed, 0))}` : ""}
      </Txt>

      {e.include ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-4">
            {categories.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                icon={categoryIcon(c.name)}
                selected={e.category_id === c.id}
                onPress={() => onChange({ category_id: c.id })}
              />
            ))}
          </ScrollView>

          <SectionLabel className="mb-2 mt-4">Paid with</SectionLabel>
          {e.payments.map((p, i) => (
            <View key={i} className="mb-2 flex-row items-center gap-2">
              <View className="flex-1">
                {p.bank_txn_id ? (
                  <View>
                    <Txt weight="medium">{accountName(p.account_id)}</Txt>
                    <Txt tone="muted" className="text-xs">
                      {txnSummary(txns.get(p.bank_txn_id))}
                    </Txt>
                  </View>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {accounts.map((a) => (
                      <Chip
                        key={a.id}
                        label={a.name}
                        selected={p.account_id === a.id}
                        onPress={() => setPayment(i, { account_id: a.id })}
                      />
                    ))}
                  </ScrollView>
                )}
              </View>
              <View className="w-24">
                <SmallInput
                  value={p.amount}
                  onChangeText={(amount) => setPayment(i, { amount })}
                  keyboardType="decimal-pad"
                  placeholder="₹"
                />
              </View>
              {e.payments.length > 1 ? (
                <Pressable
                  onPress={() => onChange({ payments: e.payments.filter((_, j) => j !== i) })}
                  accessibilityLabel="Remove payment"
                  hitSlop={8}
                >
                  <Icon icon={X} size={18} tone="muted" />
                </Pressable>
              ) : null}
            </View>
          ))}
          {cash ? (
            <Pressable
              onPress={() =>
                onChange({ payments: [...e.payments, { account_id: cash.id, bank_txn_id: null, txn_label: null, amount: "" }] })
              }
              className="flex-row items-center gap-1.5 self-start py-1.5"
            >
              <Icon icon={Plus} size={16} tone="accent" />
              <Txt weight="medium" tone="accent" className="text-sm">
                Another payment
              </Txt>
            </Pressable>
          ) : null}

          <SectionLabel className="mb-2 mt-4">Owed to you</SectionLabel>
          {e.dues.map((d, i) => (
            <View key={i} className="mb-2 flex-row items-center gap-2">
              <View className="flex-1">
                <SmallInput value={d.name} onChangeText={(name) => setDue(i, { name })} placeholder="Name" />
              </View>
              <View className="w-24">
                <SmallInput
                  value={d.amount}
                  onChangeText={(amount) => setDue(i, { amount })}
                  keyboardType="decimal-pad"
                  placeholder="₹"
                />
              </View>
              <Pressable
                onPress={() => onChange({ dues: e.dues.filter((_, j) => j !== i) })}
                accessibilityLabel="Remove person"
                hitSlop={8}
              >
                <Icon icon={X} size={18} tone="muted" />
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={() => onChange({ dues: [...e.dues, { name: "", amount: "" }] })}
            className="flex-row items-center gap-1.5 self-start py-1.5"
          >
            <Icon icon={Plus} size={16} tone="accent" />
            <Txt weight="medium" tone="accent" className="text-sm">
              Someone owes you
            </Txt>
          </Pressable>

          {e.issues.map((issue, i) => (
            <Txt key={i} tone="warn" className="mt-2 text-sm">
              {issue}
            </Txt>
          ))}
        </>
      ) : null}
    </View>
  );
}
