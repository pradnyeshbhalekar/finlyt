// History: everything that happened with your money, newest first and grouped by day. Entries,
// paybacks you received, money you owe (and paying it back), transfers, income, ignored bank
// payments, and plan changes.
import { router } from "expo-router";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  Copy,
  EyeOff,
  HandCoins,
  Target,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";
import { ActivityIndicator, Pressable, SectionList, View } from "react-native";

import { Coin } from "@/components/brand";
import { CategoryBadge } from "@/components/category-icon";
import { ExpenseRow } from "@/components/expense-row";
import { Icon, Row, Txt } from "@/components/ui";
import { dayHeading, isoDate, timeLabel } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { useActivity, useDeleteExpense, useDuplicates, useMeta } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import type { ActivityItem, Expense } from "@/lib/types";
import { confirmDelete as askDelete } from "@/lib/ask-sheet";

type DaySection = { day: string; spent: number; data: ActivityItem[] };

function groupByDay(items: ActivityItem[]): DaySection[] {
  const groups = new Map<string, DaySection>();
  for (const item of items) {
    const day = isoDate(new Date(item.at));
    const group = groups.get(day) ?? { day, spent: 0, data: [] };
    if (item.type === "expense") group.spent += item.expense.my_share_paise;
    group.data.push(item);
    groups.set(day, group);
  }
  return [...groups.values()];
}

function Badge({ icon, tone = "muted" }: { icon: LucideIcon; tone?: "muted" | "accent" }) {
  return (
    <View className="h-10 w-10 items-center justify-center rounded-full bg-surface">
      <Icon icon={icon} size={18} tone={tone} />
    </View>
  );
}

function Amount({ paise, sign = "", tone = "fg" }: { paise: number; sign?: string; tone?: "fg" | "accent" | "muted" }) {
  return (
    <Txt weight="semibold" tone={tone} className="text-base">
      {sign}
      {formatPaise(paise)}
    </Txt>
  );
}

const BANK: Record<string, { label: string; icon: LucideIcon }> = {
  transfer: { label: "Transfer", icon: ArrowLeftRight },
  income: { label: "Income", icon: ArrowDownLeft },
  ignored: { label: "Not spending", icon: EyeOff },
};

export default function History() {
  const { colors } = useTheme();
  const meta = useMeta();
  const feed = useActivity();
  const dupes = useDuplicates();
  const dupeCount = (dupes.data?.groups ?? []).reduce((n, g) => n + g.items.length - 1, 0);
  const remove = useDeleteExpense();

  const accounts = new Map((meta.data?.accounts ?? []).map((a) => [a.id, a]));
  const categories = new Map((meta.data?.categories ?? []).map((c) => [c.id, c]));
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  function confirmDelete(expense: Expense) {
    askDelete("Delete this entry?", `${expense.description} · ${formatPaise(expense.my_share_paise)}`, () =>
      remove.mutate(expense.id),
    );
  }

  function renderItem(item: ActivityItem) {
    const time = timeLabel(item.at);
    switch (item.type) {
      case "expense":
        return (
          <ExpenseRow
            expense={item.expense}
            accounts={accounts}
            categories={categories}
            onPress={() => router.push({ pathname: "/expense/[id]", params: { id: String(item.expense.id) } })}
            onLongPress={() => confirmDelete(item.expense)}
          />
        );
      case "payback":
        return (
          <Row
            leading={<Badge icon={HandCoins} tone="accent" />}
            title={`${item.person} paid you back`}
            subtitle={`${time} · ${item.method === "txn" ? "UPI" : "Cash"}${item.for.length ? ` · for ${item.for.join(", ")}` : ""}`}
            trailing={<Amount paise={item.amount_paise} sign="+" tone="accent" />}
          />
        );
      case "debt": {
        const category = item.category_id != null ? categories.get(item.category_id)?.name : null;
        return (
          <Row
            leading={category ? <CategoryBadge name={category} /> : <Badge icon={UserRound} />}
            title={`You owe ${item.person}`}
            subtitle={`${time} · ${item.description}${item.status === "settled" ? " · paid back" : ""}`}
            trailing={<Amount paise={item.amount_paise} tone={item.status === "settled" ? "muted" : "fg"} />}
          />
        );
      }
      case "bank": {
        const kind = BANK[item.status] ?? BANK.ignored;
        const account = accounts.get(item.account_id)?.name;
        return (
          <Row
            leading={<Badge icon={kind.icon} />}
            title={`${kind.label} · ${item.name}`}
            subtitle={[time, account].filter(Boolean).join(" · ")}
            trailing={<Amount paise={item.amount_paise} sign={item.direction === "credit" ? "+" : ""} tone="muted" />}
          />
        );
      }
      case "plan":
        return (
          <Row
            leading={<Badge icon={Target} tone="accent" />}
            title={`New plan: ${formatPaise(item.daily_limit_paise)} a day`}
            subtitle={item.notes ?? time}
          />
        );
    }
  }

  return (
    <SectionList
      className="flex-1 bg-bg"
      sections={groupByDay(items)}
      keyExtractor={(item, i) => `${item.type}-${item.at}-${i}`}
      contentContainerClassName="px-2 pb-16"
      stickySectionHeadersEnabled
      refreshing={feed.isRefetching && !feed.isFetchingNextPage}
      onRefresh={() => void feed.refetch()}
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
      }}
      ListHeaderComponent={
        <View className="px-3 pb-1">
          {dupeCount > 0 ? (
            <Pressable
              onPress={() => router.push("/duplicates")}
              accessibilityRole="button"
              className="mt-3 flex-row items-center gap-3 rounded-2xl px-4 py-3 active:opacity-70"
              style={{ backgroundColor: colors.warnBg }}
            >
              <Icon icon={Copy} size={18} tone="fg" />
              <Txt weight="medium" className="flex-1 text-sm" style={{ color: colors.warnFg }}>
                {dupeCount} possible {dupeCount === 1 ? "duplicate" : "duplicates"}, likely from importing the same chat
                twice
              </Txt>
              <Txt weight="semibold" className="text-sm" style={{ color: colors.warnFg }}>
                Review
              </Txt>
            </Pressable>
          ) : null}
          {feed.error ? (
            <Txt tone="danger" className="mt-2 text-sm">
              {feed.error.message}
            </Txt>
          ) : null}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <View className="flex-row justify-between bg-bg px-3 pb-1 pt-6">
          <Txt weight="semibold" className="text-sm">
            {dayHeading(section.day)}
          </Txt>
          {section.spent > 0 ? (
            <Txt tone="muted" className="text-sm">
              {formatPaise(section.spent)} spent
            </Txt>
          ) : null}
        </View>
      )}
      renderItem={({ item }) => renderItem(item)}
      ListFooterComponent={
        feed.isFetchingNextPage ? <ActivityIndicator className="mt-4" color={colors.muted} /> : undefined
      }
      ListEmptyComponent={
        feed.isLoading ? (
          <ActivityIndicator className="mt-10" color={colors.muted} />
        ) : (
          <View className="mt-12 items-center">
            <Coin size={56} variant="bare" mood="sleepy" />
            <Txt tone="muted" className="mt-3">
              Nothing here yet.
            </Txt>
          </View>
        )
      }
    />
  );
}
