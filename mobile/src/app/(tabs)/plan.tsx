// Plan: this month's budget, today's limit and what's left, what's been saved for surprises,
// the bigger spends set aside, and the Sunday check-in. Talk to Finlyt to make or change it.
import { router } from "expo-router";
import { BookmarkCheck, CalendarClock, ChartColumn, Check, MessagesSquare } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Coin } from "@/components/brand";
import { CategoryBadge } from "@/components/category-icon";
import { formatClock, TimePickerSheet } from "@/components/time-picker";
import { Button, Icon, Row, SectionLabel, Txt } from "@/components/ui";
import { formatPaise } from "@/lib/money";
import { DEFAULT_CHECK_IN, getCheckIn, saveCheckIn, WEEKDAYS, type CheckIn, type ReminderTime } from "@/lib/notifications";
import { useMeta, usePlan } from "@/lib/queries";
import { useTheme } from "@/lib/theme";

function Bar({ ratio, danger = false }: { ratio: number; danger?: boolean }) {
  const pct = Math.max(0, Math.min(ratio, 1)) * 100;
  return (
    <View className="h-2 overflow-hidden rounded-full bg-line">
      <View className={`h-2 rounded-full ${danger ? "bg-danger" : "bg-brand"}`} style={{ width: `${pct}%` }} />
    </View>
  );
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const appear = (i: number) => FadeInDown.delay(80 * i).duration(400);

/** A small figure in a quiet tile. */
function Stat({
  label,
  value,
  note,
  danger = false,
  accent = false,
}: {
  label: string;
  value: string;
  note?: string;
  danger?: boolean;
  accent?: boolean;
}) {
  return (
    <View className="flex-1 rounded-3xl bg-surface px-4 py-3.5">
      <Txt tone="muted" className="text-xs" numberOfLines={1}>
        {label}
      </Txt>
      <Txt weight="semibold" tone={danger ? "danger" : accent ? "accent" : "fg"} className="mt-1 text-lg">
        {value}
      </Txt>
      {note ? (
        <Txt tone={danger ? "danger" : "muted"} className="text-xs" numberOfLines={1}>
          {note}
        </Txt>
      ) : null}
    </View>
  );
}

export default function PlanOverview() {
  const { colors } = useTheme();
  const plan = usePlan();
  const meta = useMeta();
  const [checkIn, setCheckIn] = useState<CheckIn>(DEFAULT_CHECK_IN);
  const [picking, setPicking] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    void getCheckIn().then(setCheckIn);
  }, []);

  async function changeCheckIn(time: ReminderTime, weekday: number) {
    setPicking(false);
    const next = { ...time, weekday };
    setCheckIn(next);
    await saveCheckIn(next);
    void plan.refetch(); // the day decides when a check-in is due and where weeks start
  }

  const st = plan.data;
  const categories = new Map((meta.data?.categories ?? []).map((c) => [c.id, c]));
  const month = st ? new Date(`${st.month}T00:00:00`).toLocaleDateString("en-IN", { month: "long" }) : "";
  // The report, the memory and the check-in day: shown with or without a plan.
  const links = (
    <View className="-mx-3">
      <Row
        onPress={() => router.push("/report")}
        leading={<Icon icon={ChartColumn} size={20} tone="muted" />}
        title={`${month || new Date().toLocaleDateString("en-IN", { month: "long" })} report`}
        subtitle="Where your money went, and how it compares"
      />
      <Row
        onPress={() => router.push("/memory")}
        leading={<Icon icon={BookmarkCheck} size={20} tone="muted" />}
        title="What Finlyt remembers"
        subtitle="Your income, monthly commitments and notes"
      />
      <Row
        onPress={() => {
          setRound((r) => r + 1);
          setPicking(true);
        }}
        leading={<Icon icon={CalendarClock} size={20} tone="muted" />}
        title={`Check-in every ${WEEKDAYS[checkIn.weekday]}`}
        subtitle={`${formatClock(checkIn)} · tap to change`}
      />
    </View>
  );
  const picker = (
    <TimePickerSheet
      key={round}
      visible={picking}
      initial={checkIn}
      initialWeekday={checkIn.weekday}
      onClose={() => setPicking(false)}
      onDone={(time, weekday) => void changeCheckIn(time, weekday)}
    />
  );
  const footer = (
    <View className="px-5 pb-3 pt-2">
      <Button
        label={st?.plan ? "Talk to Finlyt" : "Make a plan with Finlyt"}
        icon={MessagesSquare}
        onPress={() => router.push("/plan/chat")}
      />
    </View>
  );

  if (plan.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  if (!st || (!st.plan && !st.budget_paise)) {
    return (
      <View className="flex-1 bg-bg">
        <ScrollView contentContainerClassName="px-8 pb-8 pt-10">
          <Animated.View entering={appear(0)}>
            <Coin size={64} variant="bare" />
          </Animated.View>
          <Animated.View entering={appear(1)}>
            <Txt weight="bold" className="mt-6 text-3xl" style={{ letterSpacing: -0.5 }}>
              No plan yet
            </Txt>
          </Animated.View>
          <Animated.View entering={appear(2)}>
            <Txt tone="muted" className="mt-3 text-base leading-6">
              {plan.error
                ? plan.error.message
                : `Tell Finlyt your budget for the month and what's coming up. You'll get limits that fit how you spend, and a short check-in every ${WEEKDAYS[checkIn.weekday]}.`}
            </Txt>
          </Animated.View>
          <Animated.View entering={appear(3)} className="mt-8">
            {links}
          </Animated.View>
        </ScrollView>
        {footer}
        {picker}
      </View>
    );
  }

  const budget = st.budget_paise ?? 0;
  const limit = st.today_limit_paise ?? st.plan?.daily_limit_paise ?? 0;
  const bigDays = st.plan?.big_days_per_week ?? 0;
  const left = st.today_left_paise ?? 0;
  const buffer = st.buffer_paise;

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="px-5 pb-8 pt-2">
        {st.plan ? (
          <Animated.View entering={appear(0)}>
            <Txt tone="muted" className="text-sm">
              Today{st.today_is_big_day ? " · a bigger day" : ""}
            </Txt>
            <Txt weight="bold" tone={left < 0 ? "danger" : "fg"} className="mt-1 text-5xl" style={{ letterSpacing: -1.2 }}>
              {formatPaise(Math.abs(left))}
            </Txt>
            <Txt tone="muted" className="text-sm">
              {left >= 0 ? `left of today's ${formatPaise(limit)}` : `over today's ${formatPaise(limit)}`}
            </Txt>
            <View className="mt-3">
              <Bar ratio={st.today_spent_paise / Math.max(limit, 1)} danger={left < 0} />
            </View>
            {bigDays > 0 && st.plan.big_day_limit_paise ? (
              <Txt tone="muted" className="mt-2 text-sm">
                {st.big_days_left === 0
                  ? "No bigger days left this week"
                  : `${st.big_days_left} bigger ${st.big_days_left === 1 ? "day" : "days"} left this week, up to ${formatPaise(st.plan.big_day_limit_paise)}`}
              </Txt>
            ) : null}
          </Animated.View>
        ) : null}

        <Animated.View entering={appear(1)} className="mt-6 flex-row gap-3">
          <Stat
            label={budget ? `${month} budget` : month}
            value={formatPaise(st.spent_month_paise)}
            note={
              budget
                ? st.spent_month_paise > budget
                  ? `${formatPaise(st.spent_month_paise - budget)} over ${formatPaise(budget)}`
                  : `of ${formatPaise(budget)} · ${st.days_left} ${st.days_left === 1 ? "day" : "days"} left`
                : `${st.days_left} ${st.days_left === 1 ? "day" : "days"} left`
            }
            danger={budget > 0 && st.spent_month_paise > budget}
          />
          {st.plan ? (
            <Stat
              label={buffer >= 0 ? "Saved for surprises" : "Over plan"}
              value={formatPaise(Math.abs(buffer))}
              note="this month"
              danger={buffer < 0}
              accent={buffer > 0}
            />
          ) : null}
        </Animated.View>

        {st.planned_items.length > 0 ? (
          <Animated.View entering={appear(2)}>
            <SectionLabel className="mb-1 mt-8">Set aside this month</SectionLabel>
            <View className="-mx-3">
              {st.planned_items.map((item, i) => {
                const paid = (item.spent_paise ?? 0) >= item.amount_paise;
                return (
                  <Row
                    key={item.id ?? i}
                    leading={
                      <CategoryBadge
                        name={item.category_id != null ? categories.get(item.category_id)?.name : null}
                        size={38}
                      />
                    }
                    title={item.description}
                    subtitle={[
                      item.due_on ? shortDate(item.due_on) : null,
                      paid ? "Paid" : item.spent_paise ? `${formatPaise(item.spent_paise)} spent` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    trailing={
                      <View className="flex-row items-center gap-1.5">
                        {paid ? <Icon icon={Check} size={16} tone="accent" /> : null}
                        <Txt weight="semibold">{formatPaise(item.amount_paise)}</Txt>
                      </View>
                    }
                  />
                );
              })}
            </View>
          </Animated.View>
        ) : null}

        <Animated.View entering={appear(3)}>
          <SectionLabel className="mb-1 mt-8">More</SectionLabel>
          {links}
        </Animated.View>
      </ScrollView>
      {footer}
      {picker}
    </View>
  );
}
