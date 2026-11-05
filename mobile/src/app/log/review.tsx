import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState, type ComponentProps } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

import { Coin } from "@/components/brand";
import { Button, Card, Chip, Label, Muted } from "@/components/ui";
import { dayLabel, isoDate, timeLabel } from "@/lib/dates";
import { logDraft, useLogDraft } from "@/lib/log-draft";
import { formatPaise, parseRupees } from "@/lib/money";
import { useCommitLog, useMeta } from "@/lib/queries";
import { colors } from "@/lib/theme";
import type {
  Account,
  Category,
  LogCommit,
  PendingTxn,
  ProposedExpense,
  ProposedSettlement,
  TxnNote,
} from "@/lib/types";

type EditPayment = {
  account_id: number;
  bank_txn_id: number | null;
  txn_label: string | null;
  amount: string;
};
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
type Toggle<T> = T & { include: boolean };

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

function sum(values: (number | null)[]): number {
  return values.reduce<number>((total, v) => total + (v ?? 0), 0);
}

export default function Review() {
  const { proposal, text } = useLogDraft();
  const meta = useMeta();
  const commit = useCommitLog();
  const [expenses, setExpenses] = useState<EditExpense[]>(() =>
    (proposal?.expenses ?? []).map(toEdit),
  );
  const [settlements, setSettlements] = useState<Toggle<ProposedSettlement>[]>(() =>
    (proposal?.settlements ?? []).map((s) => ({ ...s, include: s.issues.length === 0 })),
  );
  const [transfers, setTransfers] = useState<Toggle<TxnNote>[]>(() =>
    (proposal?.transfers ?? []).map((t) => ({ ...t, include: true })),
  );
  const [ignored, setIgnored] = useState<Toggle<TxnNote>[]>(() =>
    (proposal?.ignored ?? []).map((t) => ({ ...t, include: true })),
  );
  const [error, setError] = useState<string | null>(null);

  if (!proposal) {
    return (
      <View className="flex-1 items-center justify-center bg-white p-8 dark:bg-black">
        <Coin size={72} mood="sleepy" />
        <Muted className="mt-4 text-center">Nothing to review. Log something on the Log tab first.</Muted>
      </View>
    );
  }

  const accounts = meta.data?.accounts ?? [];
  const categories = meta.data?.categories ?? [];
  const txns = new Map(proposal.txns.map((t) => [t.id, t]));
  const note = (proposal.transcript || text).slice(0, 4000) || null;

  function updateExpense(i: number, change: Partial<EditExpense>) {
    setExpenses((list) => list.map((e, j) => (j === i ? { ...e, ...change } : e)));
  }

  function buildCommit(): LogCommit | string {
    const body: LogCommit = { expenses: [], settlements: [], transfers: [], ignored: [] };
    for (const e of expenses.filter((x) => x.include)) {
      const name = e.description.trim() || "this expense";
      if (!e.description.trim()) return "Every expense needs a description.";
      const payments = e.payments.map((p) => ({ ...p, paise: parseRupees(p.amount) }));
      if (payments.length === 0 || payments.some((p) => !p.paise)) {
        return `Check the payment amounts for “${name}”.`;
      }
      const dues = [];
      for (const d of e.dues) {
        if (!d.name.trim() && !d.amount.trim()) continue;
        const paise = parseRupees(d.amount);
        if (!d.name.trim() || !paise) return `Each person who owes you for “${name}” needs a name and amount.`;
        dues.push({ person_name: d.name.trim(), amount_paise: paise });
      }
      const total = sum(payments.map((p) => p.paise));
      if (sum(dues.map((d) => d.amount_paise)) > total) {
        return `People can't owe you more than you paid for “${name}”.`;
      }
      body.expenses.push({
        occurred_at: e.occurred_at,
        description: e.description.trim(),
        category_id: e.category_id,
        payments: payments.map((p) => ({
          account_id: p.account_id,
          amount_paise: p.paise ?? 0,
          bank_txn_id: p.bank_txn_id,
        })),
        dues,
        note_raw: note,
      });
    }
    for (const s of settlements.filter((x) => x.include)) {
      body.settlements.push({
        person_name: s.person_name,
        amount_paise: s.amount_paise,
        bank_txn_id: s.bank_txn_id,
      });
    }
    body.transfers = transfers.filter((t) => t.include).map((t) => t.bank_txn_id);
    body.ignored = ignored.filter((t) => t.include).map((t) => t.bank_txn_id);
    const count =
      body.expenses.length + body.settlements.length + body.transfers.length + body.ignored.length;
    return count === 0 ? "Everything is switched off, so there's nothing to save." : body;
  }

  async function save() {
    const body = buildCommit();
    if (typeof body === "string") {
      setError(body);
      return;
    }
    setError(null);
    try {
      await commit.mutateAsync(body);
      const parts = [];
      if (body.expenses.length) {
        parts.push(`${body.expenses.length} expense${body.expenses.length === 1 ? "" : "s"}`);
      }
      if (body.settlements.length) {
        parts.push(`${body.settlements.length} payback${body.settlements.length === 1 ? "" : "s"}`);
      }
      // Leave first so this screen doesn't re-render empty once the draft is cleared.
      router.back();
      logDraft.finish(parts.length ? `Saved ${parts.join(" and ")}.` : "Saved.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const included = expenses.filter((e) => e.include).length;

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="p-4 pb-16"
      keyboardShouldPersistTaps="handled"
    >
      {proposal.questions.length > 0 ? (
        <View className="mb-4 rounded-2xl bg-amber-50 p-4 dark:bg-amber-950">
          <Text className="mb-1 font-semibold text-amber-900 dark:text-amber-200">
            Gemini wasn&apos;t sure about
          </Text>
          {proposal.questions.map((q, i) => (
            <Text key={i} className="text-amber-900 dark:text-amber-200">
              • {q}
            </Text>
          ))}
          <Text className="mt-2 text-sm text-amber-800 dark:text-amber-300">
            Fix it below, or go back and add more detail.
          </Text>
        </View>
      ) : null}

      {proposal.transcript ? (
        <Card className="mb-4">
          <Label>You said</Label>
          <Text className="italic text-zinc-700 dark:text-zinc-300">“{proposal.transcript}”</Text>
        </Card>
      ) : null}

      {expenses.map((e, i) => (
        <ExpenseCard
          key={i}
          expense={e}
          accounts={accounts}
          categories={categories}
          txns={txns}
          onChange={(change) => updateExpense(i, change)}
        />
      ))}

      {settlements.length > 0 ? <Label>Paybacks</Label> : null}
      {settlements.map((s, i) => (
        <ToggleRow
          key={i}
          title={`${s.person_name} paid you back ${formatPaise(s.amount_paise)}`}
          subtitle={s.txn_label ? `Arrived as ${s.txn_label}` : "Cash"}
          issues={s.issues}
          value={s.include}
          onChange={(include) =>
            setSettlements((list) => list.map((x, j) => (j === i ? { ...x, include } : x)))
          }
        />
      ))}

      {transfers.length + ignored.length > 0 ? <Label>Bank transactions</Label> : null}
      {transfers.map((t, i) => (
        <ToggleRow
          key={`t${i}`}
          title={`${t.txn_label}: ${txnSummary(txns.get(t.bank_txn_id))} is a transfer`}
          subtitle={t.reason}
          issues={[]}
          value={t.include}
          onChange={(include) =>
            setTransfers((list) => list.map((x, j) => (j === i ? { ...x, include } : x)))
          }
        />
      ))}
      {ignored.map((t, i) => (
        <ToggleRow
          key={`i${i}`}
          title={`Ignore ${t.txn_label}: ${txnSummary(txns.get(t.bank_txn_id))}`}
          subtitle={t.reason}
          issues={[]}
          value={t.include}
          onChange={(include) =>
            setIgnored((list) => list.map((x, j) => (j === i ? { ...x, include } : x)))
          }
        />
      ))}

      {error ? <Text className="mb-2 mt-2 text-sm text-red-600">{error}</Text> : null}
      <View className="mt-4">
        <Button
          label={included > 0 ? `Save ${included} expense${included === 1 ? "" : "s"}` : "Save"}
          onPress={() => void save()}
          loading={commit.isPending}
        />
      </View>
      <Muted className="mt-3 text-center">Reviewed by you, read by {proposal.model}.</Muted>
    </ScrollView>
  );
}

function txnSummary(t: PendingTxn | undefined): string {
  if (!t) return "transaction";
  const party = t.counterparty ? ` ${t.direction === "debit" ? "to" : "from"} ${t.counterparty}` : "";
  return `${formatPaise(t.amount_paise)}${party}`;
}

function Issues({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <View className="mt-2 rounded-xl bg-amber-50 p-2 dark:bg-amber-950">
      {issues.map((issue, i) => (
        <Text key={i} className="text-sm text-amber-900 dark:text-amber-200">
          ⚠︎ {issue}
        </Text>
      ))}
    </View>
  );
}

function ToggleRow({
  title,
  subtitle,
  issues,
  value,
  onChange,
}: {
  title: string;
  subtitle: string;
  issues: string[];
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Card className={`mb-3 ${value ? "" : "opacity-60"}`}>
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1">
          <Text className="font-medium text-ink dark:text-white">{title}</Text>
          <Muted>{subtitle}</Muted>
        </View>
        <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
      </View>
      <Issues issues={issues} />
    </Card>
  );
}

function SmallInput(props: ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      className="rounded-lg border border-zinc-300 bg-white px-2 py-2 text-base text-ink dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      {...props}
    />
  );
}

function ExpenseCard({
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
  const total = sum(e.payments.map((p) => parseRupees(p.amount)));
  const owed = sum(e.dues.map((d) => parseRupees(d.amount)));
  const accountName = (id: number) => accounts.find((a) => a.id === id)?.name ?? "Account";
  const cash = accounts.find((a) => a.kind === "cash") ?? accounts[0];
  const date = new Date(e.occurred_at);

  const setPayment = (i: number, change: Partial<EditPayment>) =>
    onChange({ payments: e.payments.map((p, j) => (j === i ? { ...p, ...change } : p)) });
  const setDue = (i: number, change: Partial<EditDue>) =>
    onChange({ dues: e.dues.map((d, j) => (j === i ? { ...d, ...change } : d)) });

  return (
    <Card className={`mb-4 ${e.include ? "" : "opacity-60"}`}>
      <View className="flex-row items-center gap-2">
        <TextInput
          value={e.description}
          onChangeText={(description) => onChange({ description })}
          className="flex-1 text-lg font-semibold text-ink dark:text-white"
          placeholder="What was it?"
          placeholderTextColor={colors.muted}
        />
        <Switch
          value={e.include}
          onValueChange={(include) => onChange({ include })}
          trackColor={{ true: colors.primary }}
          accessibilityLabel="Save this expense"
        />
      </View>
      <Muted>
        {dayLabel(isoDate(date))}, {timeLabel(e.occurred_at)} · {formatPaise(total)}
        {owed > 0 ? ` · your share ${formatPaise(Math.max(total - owed, 0))}` : ""}
      </Muted>

      {e.include ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
            {categories.map((c) => (
              <Chip
                key={c.id}
                label={`${c.emoji} ${c.name}`}
                selected={e.category_id === c.id}
                onPress={() => onChange({ category_id: c.id })}
              />
            ))}
          </ScrollView>

          <Label>Paid with</Label>
          {e.payments.map((p, i) => (
            <View key={i} className="mb-2 flex-row items-center gap-2">
              <View className="flex-1">
                {p.bank_txn_id ? (
                  <View>
                    <Text className="font-medium text-ink dark:text-white">
                      {p.txn_label} · {accountName(p.account_id)}
                    </Text>
                    <Muted>{txnSummary(txns.get(p.bank_txn_id))}</Muted>
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
                  className="p-1"
                >
                  <Ionicons name="close" size={18} color={colors.muted} />
                </Pressable>
              ) : null}
            </View>
          ))}
          {cash ? (
            <Pressable
              onPress={() =>
                onChange({
                  payments: [
                    ...e.payments,
                    { account_id: cash.id, bank_txn_id: null, txn_label: null, amount: "" },
                  ],
                })
              }
              className="py-1"
            >
              <Text className="font-medium text-primary dark:text-primary-300">+ Another payment</Text>
            </Pressable>
          ) : null}

          <Label>Owed to you</Label>
          {e.dues.map((d, i) => (
            <View key={i} className="mb-2 flex-row items-center gap-2">
              <View className="flex-1">
                <SmallInput
                  value={d.name}
                  onChangeText={(name) => setDue(i, { name })}
                  placeholder="Name"
                />
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
                className="p-1"
              >
                <Ionicons name="close" size={18} color={colors.muted} />
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={() => onChange({ dues: [...e.dues, { name: "", amount: "" }] })}
            className="py-1"
          >
            <Text className="font-medium text-primary dark:text-primary-300">+ Someone owes you</Text>
          </Pressable>

          <Issues issues={e.issues} />
        </>
      ) : null}
    </Card>
  );
}
