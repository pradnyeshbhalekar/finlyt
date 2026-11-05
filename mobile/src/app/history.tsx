import { ActivityIndicator, Alert, SectionList, View } from "react-native";

import { Coin } from "@/components/brand";
import { ExpenseRow } from "@/components/expense-row";
import { Txt } from "@/components/ui";
import { dayLabel, isoDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { useDeleteExpense, useExpenses, useMeta } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
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
  const { colors } = useTheme();
  const meta = useMeta();
  const list = useExpenses({ limit: 300 });
  const remove = useDeleteExpense();

  const accounts = new Map((meta.data?.accounts ?? []).map((a) => [a.id, a]));
  const categories = new Map((meta.data?.categories ?? []).map((c) => [c.id, c]));

  function confirmDelete(expense: Expense) {
    Alert.alert("Delete this entry?", `${expense.description} · ${formatPaise(expense.my_share_paise)}`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate(expense.id) },
    ]);
  }

  return (
    <SectionList
      className="flex-1 bg-bg"
      sections={groupByDay(list.data?.items ?? [])}
      keyExtractor={(e) => String(e.id)}
      contentContainerClassName="px-2 pb-16"
      stickySectionHeadersEnabled
      refreshing={list.isRefetching}
      onRefresh={() => void list.refetch()}
      ListHeaderComponent={
        <View className="px-3 pb-1">
          <Txt tone="muted" className="text-sm">
            Long-press an entry to delete it.
          </Txt>
          {list.error ? (
            <Txt tone="danger" className="mt-2 text-sm">
              {list.error.message}
            </Txt>
          ) : null}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <View className="flex-row justify-between bg-bg px-3 pb-1 pt-6">
          <Txt weight="semibold" className="text-sm">
            {dayLabel(section.day)}
          </Txt>
          <Txt tone="muted" className="text-sm">
            {formatPaise(section.total)}
          </Txt>
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
          <ActivityIndicator className="mt-10" color={colors.muted} />
        ) : (
          <View className="mt-12 items-center">
            <Coin size={56} variant="bare" mood="sleepy" />
            <Txt tone="muted" className="mt-3">
              Nothing logged yet.
            </Txt>
          </View>
        )
      }
    />
  );
}
