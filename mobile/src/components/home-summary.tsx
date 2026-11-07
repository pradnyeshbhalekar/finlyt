// The top of Home, kept calm: today's spend with one thin bar against today's limit, then two
// small tiles (this month, and money owed) that open the report and Owed. A check-in nudge
// appears only when one is due. The details (bigger days, the buffer, categories) live in Plan
// and the month report.
import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { formatPaise } from "@/lib/money";
import { todayWeekday, WEEKDAYS } from "@/lib/notifications";
import { useTheme } from "@/lib/theme";
import type { PlanStatus } from "@/lib/types";

import { Coin } from "./brand";
import { Icon, Txt } from "./ui";

/** Today's spend, big, and what's left of today's limit under it. */
export function TodayHero({ spentPaise, plan }: { spentPaise: number; plan: PlanStatus | undefined }) {
  const { colors } = useTheme();
  const limit = plan?.today_limit_paise ?? null;
  const left = plan?.today_left_paise ?? null;
  const ratio = limit ? Math.min(spentPaise / limit, 1) : 0;
  return (
    <Pressable onPress={() => router.push("/plan")} disabled={!limit} accessibilityRole="button" className="mt-6">
      <Txt tone="muted" className="text-sm">
        Today
      </Txt>
      <Txt weight="bold" className="mt-1 text-5xl" style={{ letterSpacing: -1.2 }}>
        {formatPaise(spentPaise)}
      </Txt>
      {limit !== null && left !== null ? (
        <View className="mt-3">
          <View className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: colors.surface }}>
            <View
              className="h-1.5 rounded-full"
              style={{ width: `${Math.max(ratio * 100, spentPaise > 0 ? 2 : 0)}%`, backgroundColor: left < 0 ? colors.danger : colors.chart }}
            />
          </View>
          <Txt tone={left < 0 ? "danger" : "muted"} className="mt-2 text-sm">
            {left >= 0
              ? `${formatPaise(left)} left of today's ${formatPaise(limit)}${plan?.today_is_big_day ? " (a bigger day)" : ""}`
              : `${formatPaise(-left)} over today's ${formatPaise(limit)}`}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

function Tile({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-1 rounded-3xl bg-surface px-4 py-3.5 active:opacity-70"
    >
      <View className="flex-row items-center justify-between">
        <Txt tone="muted" className="text-xs">
          {label}
        </Txt>
        <Icon icon={ChevronRight} size={14} tone="faint" />
      </View>
      {children}
    </Pressable>
  );
}

/** This month and money owed, side by side. */
export function SummaryTiles({
  monthPaise,
  budgetPaise,
  owedToMePaise,
  iOwePaise,
}: {
  monthPaise: number;
  budgetPaise: number | null;
  owedToMePaise: number;
  iOwePaise: number;
}) {
  const over = budgetPaise ? monthPaise - budgetPaise : 0;
  const month = new Date().toLocaleDateString("en-IN", { month: "long" });
  return (
    <View className="mt-6 flex-row gap-3">
      <Tile label={month} onPress={() => router.push("/report")}>
        <Txt weight="semibold" className="mt-1 text-lg">
          {formatPaise(monthPaise)}
        </Txt>
        <Txt tone={over > 0 ? "danger" : "muted"} className="text-xs" numberOfLines={1}>
          {budgetPaise ? (over > 0 ? `${formatPaise(over)} over budget` : `of ${formatPaise(budgetPaise)}`) : "See where it went"}
        </Txt>
      </Tile>
      <Tile label="Owed" onPress={() => router.push("/owed")}>
        <Txt weight="semibold" className="mt-1 text-lg">
          {formatPaise(owedToMePaise)}
        </Txt>
        <Txt tone="muted" className="text-xs" numberOfLines={1}>
          {iOwePaise > 0 ? `to you · you owe ${formatPaise(iOwePaise)}` : "to you"}
        </Txt>
      </Tile>
    </View>
  );
}

/** A slim nudge when it's time for the weekly check-in (or there's no plan yet). */
export function CheckInNudge({ plan }: { plan: PlanStatus | undefined }) {
  if (!plan || !(plan.check_in_due || !plan.plan)) return null;
  const today = todayWeekday() === plan.check_in_weekday;
  const title = !plan.plan ? "Plan your month" : today ? `${WEEKDAYS[plan.check_in_weekday]} check-in` : "Time to check in";
  return (
    <Pressable
      onPress={() => router.push(plan.plan ? "/plan/chat" : "/plan")}
      accessibilityRole="button"
      className="mt-3 flex-row items-center gap-3 rounded-3xl border border-line px-4 py-3 active:opacity-70"
    >
      <Coin size={28} variant="bare" />
      <View className="flex-1">
        <Txt weight="semibold" className="text-sm">
          {title}
        </Txt>
        <Txt tone="muted" className="text-xs">
          {plan.plan ? "Tell Finlyt what's coming up this week" : "Set a budget and get limits that fit you"}
        </Txt>
      </View>
      <Icon icon={ChevronRight} size={16} tone="muted" />
    </Pressable>
  );
}
