import { ActivityIndicator, Alert, SectionList, Text, View } from "react-native";

import { ExpenseRow } from "@/components/expense-row";
import { AddButton, Muted, Screen, Title } from "@/components/ui";
import { dayLabel, isoDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { useDeleteExpense, useExpenses, useMeta } from "@/lib/queries";
import type { Expense } from "@/lib/types";

type DaySection = { day: string; total: number; data: Expense[] };

function groupByDay(items: Expense[]): DaySection[] {
  const groups = new Map<string, DaySection>();
  for (const expense of items) {
    const day = isoDate(new Date(expense.occurred_at));
    const group = groups.get(day) ?? { day, total: 0, data: [] };
    group.total += expense.my_share_paise;
    group.data.push(expense);
    groups.set(day, group);
  }
  return [...groups.values()];
}

export default function History() {
  const meta = useMeta();
  const list = useExpenses({ limit: 200 });
  const remove = useDeleteExpense();

  const accounts = new Map((meta.data?.accounts ?? []).map((a) => [a.id, a]));
  const categories = new Map((meta.data?.categories ?? []).map((c) => [c.id, c]));

  function confirmDelete(expense: Expense) {
    Alert.alert("Delete this expense?", `${expense.description} · ${formatPaise(expense.total_paise)}`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate(expense.id) },
    ]);
  }

  return (
    <Screen>
      <SectionList
        sections={groupByDay(list.data?.items ?? [])}
        keyExtractor={(e) => String(e.id)}
        contentContainerClassName="px-4 pb-28"
        stickySectionHeadersEnabled
        refreshing={list.isRefetching}
        onRefresh={() => void list.refetch()}
        ListHeaderComponent={
          <View className="pb-2 pt-4">
            <Title>History</Title>
            <Muted>Long-press an expense to delete it.</Muted>
            {list.error ? <Text className="mt-2 text-red-600">{list.error.message}</Text> : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View className="flex-row justify-between bg-white pb-1 pt-4 dark:bg-black">
            <Text className="font-semibold text-zinc-700 dark:text-zinc-300">
              {dayLabel(section.day)}
            </Text>
            <Text className="text-zinc-500">{formatPaise(section.total)}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <ExpenseRow
            expense={item}
            accounts={accounts}
            categories={categories}
            onLongPress={() => confirmDelete(item)}
          />
        )}
        ListEmptyComponent={
          list.isLoading ? (
            <ActivityIndicator className="mt-8" />
          ) : (
            <Muted className="mt-8 text-center">Nothing logged yet.</Muted>
          )
        }
      />
      <AddButton />
    </Screen>
  );
}
