// One category in one month, opened by tapping it in the month report's "Where it went": the
// total, how many entries, and each entry by day (tap one to open it).
import { router, Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, SectionList, View } from "react-native";

import { ExpenseRow } from "@/components/expense-row";
import { SectionLabel, Txt } from "@/components/ui";
import { dayLabel, isoDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { useExpenses, useMeta } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import type { Expense } from "@/lib/types";

export default function CategoryMonth() {
  const { month, category_id, name } = useLocalSearchParams<{ month: string; category_id: string; name?: string }>();
  const { colors } = useTheme();
  const meta = useMeta();
  const [y, m] = (month ?? "").split("-").map(Number);
  const first = `${month}-01`;
  const lastDay = new Date(y, m, 0);
  const today = new Date();
  const last = isoDate(lastDay < today ? lastDay : today);
  const list = useExpenses({ from: first, to: last, category_id: Number(category_id), limit: 200 });
  const accounts = new Map((meta.data?.accounts ?? []).map((a) => [a.id, a]));
  const categories = new Map((meta.data?.categories ?? []).map((c) => [c.id, c]));
  const items = list.data?.items ?? [];
  const total = items.reduce((sum, e) => sum + e.my_share_paise, 0);
  const monthName = new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long" });

  const days = new Map<string, Expense[]>();
  for (const e of items) {
    const day = isoDate(new Date(e.occurred_at));
    days.set(day, [...(days.get(day) ?? []), e]);
  }
  const sections = [...days.entries()].map(([day, data]) => ({ day, data }));

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: name ?? "Category" }} />
      {list.isPending ? (
        <View className="mt-16 items-center">
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(e) => String(e.id)}
          contentContainerClassName="px-2 pb-12"
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View className="px-3 pb-2 pt-4">
              <Txt weight="bold" className="text-4xl" style={{ letterSpacing: -0.8 }}>
                {formatPaise(total)}
              </Txt>
              <Txt tone="muted" className="mt-1 text-base">
                {items.length} {items.length === 1 ? "entry" : "entries"} in {monthName}
              </Txt>
              {list.error ? (
                <Txt tone="danger" className="mt-3 text-sm">
                  {list.error.message}
                </Txt>
              ) : null}
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View className="mt-5 flex-row items-baseline justify-between px-3">
              <SectionLabel>{dayLabel(section.day)}</SectionLabel>
              <Txt tone="muted" className="text-sm">
                {formatPaise(section.data.reduce((sum, e) => sum + e.my_share_paise, 0))}
              </Txt>
            </View>
          )}
          renderItem={({ item }) => (
            <ExpenseRow
              expense={item}
              accounts={accounts}
              categories={categories}
              onPress={() => router.push({ pathname: "/expense/[id]", params: { id: String(item.id) } })}
            />
          )}
          ListEmptyComponent={
            <Txt tone="muted" className="mt-8 px-3 text-center">
              Nothing in {name ?? "this category"} in {monthName}.
            </Txt>
          }
        />
      )}
    </View>
  );
}
