import { RefreshControl, ScrollView, Text, View } from "react-native";

import { ExpenseRow } from "@/components/expense-row";
import { AddButton, Card, Muted, Screen } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { isoDate, startOfMonth, startOfWeek } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { useExpenses, useMeta, useStats } from "@/lib/queries";

export default function Home() {
  const { user } = useAuth();
  const now = new Date();
  const today = isoDate(now);
  const month = useStats(isoDate(startOfMonth(now)), today);
  const week = useStats(isoDate(startOfWeek(now)), today);
  const day = useStats(today, today);
  const meta = useMeta();
  const recent = useExpenses({ limit: 5 });

  const accounts = new Map((meta.data?.accounts ?? []).map((a) => [a.id, a]));
  const categories = new Map((meta.data?.categories ?? []).map((c) => [c.id, c]));
  const error = month.error ?? recent.error ?? meta.error;
  const byAccount = month.data?.by_account ?? [];
  const items = recent.data?.items ?? [];

  function refresh() {
    void Promise.all([month.refetch(), week.refetch(), day.refetch(), recent.refetch(), meta.refetch()]);
  }

  return (
    <Screen>
      <ScrollView
        contentContainerClassName="p-4 pb-28"
        refreshControl={
          <RefreshControl refreshing={month.isRefetching || recent.isRefetching} onRefresh={refresh} />
        }
      >
        <Muted>{user?.name ? `Hi ${user.name.split(" ")[0]} 👋` : "Hi 👋"}</Muted>
        <Text className="mt-4 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Spent this month
        </Text>
        <Text className="text-4xl font-bold text-ink dark:text-white">
          {formatPaise(month.data?.spend_paise ?? 0)}
        </Text>

        <View className="mt-4 flex-row gap-3">
          <Tile label="Today" paise={day.data?.spend_paise} />
          <Tile label="This week" paise={week.data?.spend_paise} />
          <Tile label="Owed to you" paise={month.data?.open_dues_paise} />
        </View>

        {error ? (
          <Card className="mt-4">
            <Text className="text-red-600">{error.message}</Text>
          </Card>
        ) : null}

        <Card className="mt-4">
          <Text className="mb-2 font-semibold text-ink dark:text-white">Money out this month</Text>
          {byAccount.length === 0 ? (
            <Muted>Nothing yet.</Muted>
          ) : (
            byAccount.map((row) => (
              <View key={row.account_id} className="flex-row justify-between py-1">
                <Text className="text-zinc-700 dark:text-zinc-300">
                  {accounts.get(row.account_id)?.name ?? "Account"}
                </Text>
                <Text className="font-medium text-ink dark:text-white">
                  {formatPaise(row.paid_paise)}
                </Text>
              </View>
            ))
          )}
        </Card>

        <Card className="mt-4">
          <Text className="mb-1 font-semibold text-ink dark:text-white">Recent</Text>
          {items.length === 0 ? (
            <Muted>No expenses yet. Tap + to add one.</Muted>
          ) : (
            items.map((e) => (
              <ExpenseRow key={e.id} expense={e} accounts={accounts} categories={categories} />
            ))
          )}
        </Card>
      </ScrollView>
      <AddButton />
    </Screen>
  );
}

function Tile({ label, paise }: { label: string; paise: number | undefined }) {
  return (
    <View className="flex-1 rounded-2xl bg-primary-50 p-3 dark:bg-zinc-900">
      <Text className="text-xs text-zinc-500 dark:text-zinc-400">{label}</Text>
      <Text className="mt-1 text-lg font-semibold text-ink dark:text-white">
        {paise === undefined ? "–" : formatPaise(paise)}
      </Text>
    </View>
  );
}
