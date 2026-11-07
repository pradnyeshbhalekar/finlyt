// Home's "this month" card: the month so far, how it compares with last month, the top categories,
// and a way into the full report ("where did my money go"). If Finlyt doesn't know your income
// yet, it says so and links to What Finlyt remembers.
import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { formatPaise } from "@/lib/money";
import { useMonthReport } from "@/lib/queries";

import { RankedBars } from "./charts";
import { Icon, Txt } from "./ui";

export function MonthGlance() {
  const report = useMonthReport();
  const r = report.data;
  if (!r) return null;
  const income = r.money_in.income_source === "bank" ? r.money_in.income_paise : r.money_in.salary_paise;

  const base = r.last_month.same_point_paise;
  const diff = r.spent_paise - base;
  const compared = base
    ? `${formatPaise(Math.abs(diff))} ${diff >= 0 ? "more" : "less"} than ${r.last_month.label} by now`
    : null;
  const top = r.categories.slice(0, 3).map((c) => ({
    key: String(c.category_id ?? c.name),
    label: c.name,
    paise: c.spent_paise,
    usualPaise: c.usual_paise,
  }));

  return (
    <View className="mt-5 rounded-3xl border border-line p-4">
      <Pressable onPress={() => router.push("/report")} accessibilityRole="button" accessibilityLabel="Open this month's report">
        <View className="flex-row items-baseline justify-between">
          <Txt weight="semibold" className="text-base">
            {r.label.split(" ")[0]} so far
          </Txt>
          <Txt weight="semibold" className="text-base">
            {formatPaise(r.spent_paise)}
          </Txt>
        </View>
        {compared ? (
          <Txt tone="muted" className="mt-0.5 text-sm">
            {compared}
          </Txt>
        ) : null}
        {top.length > 0 ? (
          <View className="mt-4">
            <RankedBars rows={top} />
          </View>
        ) : (
          <Txt tone="muted" className="mt-2 text-sm">
            Nothing logged this month yet.
          </Txt>
        )}
        <View className="mt-4 flex-row items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <Txt weight="semibold">See where it went</Txt>
          <Icon icon={ChevronRight} size={18} tone="muted" />
        </View>
      </Pressable>
      {!r.money_in.income_source ? (
        <Pressable onPress={() => router.push("/memory")} hitSlop={6} className="mt-3 flex-row items-center gap-1">
          <Txt tone="accent" weight="medium" className="text-sm">
            Add your income and monthly commitments
          </Txt>
          <Icon icon={ChevronRight} size={16} tone="accent" />
        </Pressable>
      ) : income ? (
        <Txt tone={r.spent_paise > income ? "danger" : "muted"} className="mt-3 text-sm">
          {r.spent_paise > income
            ? `${formatPaise(r.spent_paise - income)} more than your ${formatPaise(income)} income`
            : `${Math.round((r.spent_paise / income) * 100)}% of your ${formatPaise(income)} income spent`}
        </Txt>
      ) : null}
    </View>
  );
}
