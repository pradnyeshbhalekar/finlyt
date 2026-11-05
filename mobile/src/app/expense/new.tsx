import { router } from "expo-router";
import { useState } from "react";
import { Plus, X } from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";

import { categoryIcon } from "@/components/category-icon";
import { KeyboardAware } from "@/components/keyboard";
import { Button, Chip, Field, Icon, SectionLabel, Txt } from "@/components/ui";
import { logDraft } from "@/lib/log-draft";
import { parseRupees } from "@/lib/money";
import { useCreateExpense, useMeta } from "@/lib/queries";
import type { NewExpense } from "@/lib/types";

type Owe = { name: string; amount: string };

export default function AddExpense() {
  const meta = useMeta();
  const create = useCreateExpense();
  const accounts = meta.data?.accounts ?? [];
  const categories = meta.data?.categories ?? [];
  const primary = accounts.find((a) => a.is_primary) ?? accounts[0];

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [splitPayment, setSplitPayment] = useState(false);
  const [secondAccountId, setSecondAccountId] = useState<number | null>(null);
  const [secondAmount, setSecondAmount] = useState("");
  const [owes, setOwes] = useState<Owe[]>([]);
  const [yesterday, setYesterday] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstAccountId = accountId ?? primary?.id ?? null;

  function buildBody(): NewExpense | string {
    const total = parseRupees(amount);
    if (!total) return "Enter the amount you paid.";
    if (!description.trim()) return "What was it for?";
    if (firstAccountId == null) return "Pick how you paid.";

    let payments: NewExpense["payments"] = [{ account_id: firstAccountId, amount_paise: total }];
    if (splitPayment) {
      const part = parseRupees(secondAmount);
      if (secondAccountId == null) return "Pick the second account.";
      if (secondAccountId === firstAccountId) return "Use two different accounts.";
      if (!part || part >= total) return "The second amount has to be less than the total.";
      payments = [
        { account_id: firstAccountId, amount_paise: total - part },
        { account_id: secondAccountId, amount_paise: part },
      ];
    }

    const dues: NewExpense["dues"] = [];
    for (const owe of owes) {
      if (!owe.name.trim() && !owe.amount.trim()) continue;
      const paise = parseRupees(owe.amount);
      if (!owe.name.trim() || !paise) return "Each person who owes you needs a name and an amount.";
      dues.push({ person_name: owe.name.trim(), amount_paise: paise });
    }
    if (dues.reduce((sum, d) => sum + d.amount_paise, 0) > total) {
      return "People can't owe you more than you paid.";
    }

    const when = new Date();
    if (yesterday) when.setDate(when.getDate() - 1);
    return {
      occurred_at: when.toISOString(),
      description: description.trim(),
      category_id: categoryId,
      payments,
      dues,
    };
  }

  async function save() {
    const body = buildBody();
    if (typeof body === "string") {
      setError(body);
      return;
    }
    setError(null);
    try {
      const expense = await create.mutateAsync(body);
      router.back();
      logDraft.saved({
        message: "Saved 1 entry",
        expenseIds: [expense.id],
        input: "",
        questions: [],
        undoable: true,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <View className="flex-1 bg-bg">
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-5 pb-16 pt-2"
      keyboardShouldPersistTaps="handled"
    >
      <Field
        label="Amount paid (₹)"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="450"
        autoFocus
      />
      <Field
        label="What for?"
        value={description}
        onChangeText={setDescription}
        placeholder="Lunch with Rahul"
      />

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

      <SectionLabel className="mb-3 mt-4">Paid with</SectionLabel>
      <View className="flex-row flex-wrap">
        {accounts.map((a) => (
          <Chip
            key={a.id}
            label={a.name}
            selected={firstAccountId === a.id}
            onPress={() => setAccountId(a.id)}
          />
        ))}
      </View>
      <Pressable onPress={() => setSplitPayment(!splitPayment)} className="self-start py-2">
        <Txt weight="medium" tone="accent">
          {splitPayment ? "Paid with one account" : "Paid part of it another way, like half cash"}
        </Txt>
      </Pressable>
      {splitPayment ? (
        <View className="mb-2 mt-1 rounded-3xl bg-surface p-4">
          <Txt weight="medium" tone="muted" className="mb-2 text-sm">
            Second payment
          </Txt>
          <View className="flex-row flex-wrap">
            {accounts
              .filter((a) => a.id !== firstAccountId)
              .map((a) => (
                <Chip
                  key={a.id}
                  label={a.name}
                  selected={secondAccountId === a.id}
                  onPress={() => setSecondAccountId(a.id)}
                />
              ))}
          </View>
          <Field
            value={secondAmount}
            onChangeText={setSecondAmount}
            keyboardType="decimal-pad"
            placeholder="How much of the total"
          />
        </View>
      ) : null}

      <SectionLabel className="mb-3 mt-4">Someone owes you?</SectionLabel>
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
            onChangeText={(value) =>
              setOwes(owes.map((o, j) => (j === i ? { ...o, amount: value } : o)))
            }
            keyboardType="decimal-pad"
            placeholder="₹"
          />
          <Pressable
            onPress={() => setOwes(owes.filter((_, j) => j !== i))}
            accessibilityLabel="Remove person"
            hitSlop={8}
            className="mb-3 px-1"
          >
            <Icon icon={X} size={18} tone="muted" />
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={() => setOwes([...owes, { name: "", amount: "" }])}
        className="flex-row items-center gap-1.5 self-start py-2"
      >
        <Icon icon={Plus} size={16} tone="accent" />
        <Txt weight="medium" tone="accent">
          Add a person
        </Txt>
      </Pressable>

      <SectionLabel className="mb-3 mt-4">When</SectionLabel>
      <View className="flex-row">
        <Chip label="Today" selected={!yesterday} onPress={() => setYesterday(false)} />
        <Chip label="Yesterday" selected={yesterday} onPress={() => setYesterday(true)} />
      </View>

      {error ? (
        <Txt tone="danger" className="mb-2 mt-2 text-sm">
          {error}
        </Txt>
      ) : null}
      <View className="mt-4">
        <Button label="Save" onPress={() => void save()} loading={create.isPending} />
      </View>
    </ScrollView>
    <KeyboardAware rest={0} />
    </View>
  );
}
