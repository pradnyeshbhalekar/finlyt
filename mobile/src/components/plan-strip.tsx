// Home's view of the plan: what's left of today's limit, and what's been saved for surprises.
// Without a plan (or when a check-in is due) it invites you to talk to Finlyt.
import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { formatPaise } from "@/lib/money";
import type { PlanStatus } from "@/lib/types";

import { Coin } from "./brand";
import { Icon, Txt } from "./ui";

export function PlanStrip({ status }: { status: PlanStatus | undefined }) {
  if (!status) return null;
  const sunday = new Date().getDay() === 0;
  const plan = status.plan;

  const invite =
    !plan || status.check_in_due ? (
      <Pressable
        onPress={() => router.push("/plan")}
        accessibilityRole="button"
        className="mt-5 flex-row items-center gap-3 rounded-3xl bg-surface p-4 active:opacity-70"
      >
        <Coin size={36} variant="bare" />
        <View className="flex-1">
          <Txt weight="semibold">{sunday ? "Sunday check-in" : plan ? "Time to check in" : "Plan your month"}</Txt>
          <Txt tone="muted" className="text-sm">
            {plan ? "Talk through the week ahead with Finlyt" : "Set a budget and get a daily limit"}
          </Txt>
        </View>
        <Icon icon={ChevronRight} size={18} tone="muted" />
      </Pressable>
    ) : null;

  if (!plan || status.today_left_paise === null) return invite;

  const limit = plan.daily_limit_paise;
  const left = status.today_left_paise;
  const used = Math.min(status.today_spent_paise / limit, 1);
  const buffer = status.buffer_paise;

  return (
    <View>
      <Pressable onPress={() => router.push("/plan")} className="mt-5 active:opacity-70" accessibilityRole="button">
        <View className="h-2 overflow-hidden rounded-full bg-surface">
          <View
            className={`h-2 rounded-full ${left < 0 ? "bg-danger" : "bg-brand"}`}
            style={{ width: `${Math.max(used * 100, used > 0 ? 3 : 0)}%` }}
          />
        </View>
        <View className="mt-2 flex-row items-baseline justify-between">
          <Txt weight="semibold" tone={left < 0 ? "danger" : "fg"} className="text-base">
            {left >= 0 ? `${formatPaise(left)} left today` : `${formatPaise(-left)} over today`}
          </Txt>
          <Txt tone="muted" className="text-sm">
            of {formatPaise(limit)}
          </Txt>
        </View>
        {buffer !== 0 ? (
          <Txt tone={buffer > 0 ? "accent" : "danger"} className="mt-1 text-sm">
            {buffer > 0
              ? `${formatPaise(buffer)} saved for surprises`
              : `${formatPaise(-buffer)} over plan this month`}
          </Txt>
        ) : null}
      </Pressable>
      {invite}
    </View>
  );
}
