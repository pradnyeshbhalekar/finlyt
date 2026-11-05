import { Pressable, Text, View } from "react-native";

import { timeLabel } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import type { Account, Category, Expense } from "@/lib/types";

export function ExpenseRow({
  expense,
  accounts,
  categories,
  onLongPress,
}: {
  expense: Expense;
  accounts: Map<number, Account>;
  categories: Map<number, Category>;
  onLongPress?: () => void;
}) {
  const category = expense.category_id != null ? categories.get(expense.category_id) : undefined;
  const paidWith = expense.payments.map((p) => accounts.get(p.account_id)?.name ?? "?").join(" + ");
  const owers = expense.dues.map((d) => d.person_name).join(", ");
  const isSplit = expense.my_share_paise !== expense.total_paise;

  return (
    <Pressable onLongPress={onLongPress} className="flex-row items-center py-3">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-100 dark:bg-zinc-800">
        <Text className="text-lg">{category?.emoji ?? "💸"}</Text>
      </View>
      <View className="ml-3 flex-1">
        <Text numberOfLines={1} className="text-base font-medium text-ink dark:text-white">
          {expense.description}
        </Text>
        <Text numberOfLines={1} className="text-xs text-zinc-500 dark:text-zinc-400">
          {timeLabel(expense.occurred_at)} · {paidWith}
          {owers ? ` · ${owers} owes you` : ""}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-base font-semibold text-ink dark:text-white">
          {formatPaise(expense.my_share_paise)}
        </Text>
        {isSplit ? (
          <Text className="text-xs text-zinc-500">of {formatPaise(expense.total_paise)}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
