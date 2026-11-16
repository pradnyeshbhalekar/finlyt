// Fix a saved entry: what it was for, its category, who owes you part of it, and (for a plain
// entry) the amount and how it was paid. Opened by the pencil on an entry's sheet. An entry paid
// two ways or matched to a bank payment keeps its amount, and once someone has paid part of
// their share back the split is locked. The date is changed on the entry's sheet.
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Plus, X } from "lucide-react-native";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";

import { categoryIcon } from "@/components/category-icon";
import { KeyboardAware } from "@/components/keyboard";
import { Button, Chip, Field, Icon, SectionLabel, Txt } from "@/components/ui";
import { formatPaise, parseRupees } from "@/lib/money";
import { useExpense, useMeta, useUpdateExpense } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import type { Account, Category, Expense } from "@/lib/types";

type Owe = { name: string; amount: string };

/** 45000 → "450", 45050 → "450.50" (what goes in the amount box). */
function rupeeInput(paise: number): string {
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

export default function EditExpense() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const expense = useExpense(Number(id));
  const meta = useMeta();

  if (!expense.data || !meta.data) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        {expense.error ? (
          <Txt tone="muted" className="text-center">
            {expense.error.message}
          </Txt>
        ) : (
          <ActivityIndicator color={colors.muted} />
        )}
      </View>
    );
  }
  // The form seeds itself from the entry once it's loaded.
  return <Form entry={expense.data} accounts={meta.data.accounts} categories={meta.data.categories} />;
}

function Form({ entry, accounts, categories }: { entry: Expense; accounts: Account[]; categories: Category[] }) {
  const update = useUpdateExpense();
  // One payment that isn't tied to a bank payment: its amount and account can change.
  const plain = entry.payments.length === 1 && !entry.payments[0].bank_txn_id;
  // Once a friend has paid some of their share back, who owes what can't change any more.
  const locked = entry.dues.some((d) => d.settled_paise > 0 || d.status !== "open");
  const before = entry.dues.map((d) => ({ name: d.person_name, amount: rupeeInput(d.amount_paise) }));
  const [owes, setOwes] = useState<Owe[]>(before);

  const [amount, setAmount] = useState(rupeeInput(entry.total_paise));
  const [description, setDescription] = useState(entry.description);
  const [categoryId, setCategoryId] = useState<number | null>(entry.category_id);
  const [accountId, setAccountId] = useState<number | null>(entry.payments[0]?.account_id ?? null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!description.trim()) {
      setError("What was it for?");
      return;
    }
    const patch: Parameters<typeof update.mutateAsync>[0] = {
      id: entry.id,
      description: description.trim(),
      category_id: categoryId,
    };
    const total = plain ? parseRupees(amount) : entry.total_paise;
    if (!total) {
      setError("Enter the amount you paid.");
      return;
    }
    const dues: { person_name: string; amount_paise: number }[] = [];
    for (const owe of owes) {
      if (!owe.name.trim() && !owe.amount.trim()) continue;
      const paise = parseRupees(owe.amount);
      if (!owe.name.trim() || !paise) {
        setError("Each person who owes you needs a name and an amount.");
        return;
      }
      dues.push({ person_name: owe.name.trim(), amount_paise: paise });
    }
    const owed = dues.reduce((sum, d) => sum + d.amount_paise, 0);
    if (owed > total) {
      setError(`Friends can't owe you more than the ${formatPaise(total)} you paid.`);
      return;
    }
    const changedSplit =
      dues.length !== before.length ||
      dues.some((d, i) => d.person_name !== before[i].name || d.amount_paise !== parseRupees(before[i].amount));
    if (changedSplit && !locked) patch.dues = dues;
    if (plain) {
      if (accountId == null) {
        setError("Pick how you paid.");
        return;
      }
      if (total !== entry.total_paise || accountId !== entry.payments[0].account_id) {
        patch.payments = [{ account_id: accountId, amount_paise: total }];
      }
    }
    setError(null);
    try {
      await update.mutateAsync(patch);
      router.back();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <View className="flex-1 bg-bg">
      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-8 pt-2" keyboardShouldPersistTaps="handled">
        {plain ? (
          <Field label="Amount paid (₹)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="450" />
        ) : (
          <View className="mb-3 rounded-2xl bg-surface p-4">
            <Txt weight="semibold" className="text-base">
              {formatPaise(entry.total_paise)}
            </Txt>
            <Txt tone="muted" className="mt-1 text-sm leading-5">
              {entry.payments.some((p) => p.bank_txn_id)
                ? "The amount comes from a bank payment, so it stays as it is."
                : "This was paid in more than one way. To change the amount, delete it and log it again."}
            </Txt>
          </View>
        )}
        <Field label="What for?" value={description} onChangeText={setDescription} placeholder="Lunch with Rahul" maxLength={200} />

        <SectionLabel className="mb-3 mt-4">Category</SectionLabel>
        <View className="flex-row flex-wrap">
          {categories.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              icon={categoryIcon(c.name)}
              selected={categoryId === c.id}
              onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
            />
          ))}
        </View>

        {plain ? (
          <>
            <SectionLabel className="mb-3 mt-4">Paid with</SectionLabel>
            <View className="flex-row flex-wrap">
              {accounts.map((a) => (
                <Chip key={a.id} label={a.name} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />
              ))}
            </View>
          </>
        ) : null}

        <SectionLabel className="mb-3 mt-4">Someone owes you part of it?</SectionLabel>
        {locked ? (
          <Txt tone="muted" className="text-sm leading-5">
            {entry.dues.map((d) => `${d.person_name} ${formatPaise(d.amount_paise)}`).join(", ")}. Some of this has been
            paid back, so the split stays as it is.
          </Txt>
        ) : (
          <>
            {owes.map((owe, i) => (
              <View key={i} className="flex-row items-center gap-2">
                <Field
                  className="flex-1"
                  value={owe.name}
                  onChangeText={(name) => setOwes(owes.map((o, j) => (j === i ? { ...o, name } : o)))}
                  placeholder="Name"
                />
                <Field
                  className="w-28"
                  value={owe.amount}
                  onChangeText={(value) => setOwes(owes.map((o, j) => (j === i ? { ...o, amount: value } : o)))}
                  keyboardType="decimal-pad"
                  placeholder="₹"
                />
                <Pressable
                  onPress={() => setOwes(owes.filter((_, j) => j !== i))}
                  accessibilityLabel="Remove person"
                  hitSlop={12}
                  className="mb-3 px-1"
                >
                  <Icon icon={X} size={18} tone="muted" />
                </Pressable>
              </View>
            ))}
            <Pressable
              onPress={() => setOwes([...owes, { name: "", amount: "" }])}
              accessibilityRole="button"
              className="min-h-11 flex-row items-center gap-1.5 self-start"
            >
              <Icon icon={Plus} size={16} tone="accent" />
              <Txt weight="medium" tone="accent">
                Add a person
              </Txt>
            </Pressable>
          </>
        )}
      </ScrollView>

      {/* Save stays in reach, above the keyboard. */}
      <KeyboardAware>
        <View className="px-5 pt-2">
          {error ? (
            <Txt tone="danger" className="mb-2 text-sm">
              {error}
            </Txt>
          ) : null}
          <Button label="Save changes" onPress={() => void save()} loading={update.isPending} />
        </View>
      </KeyboardAware>
    </View>
  );
}
