// Small habits: little things bought most days (ice cream, a cold drink, chai…) that don't look like
// much but add up over a year. Each shows how often, what a year costs, and this week against your
// limit; tap one to set a limit, or say it's fine or a need. Groceries, rent, bills, medicine,
// getting around and meals never show up here.
import { RotateCcw } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";

import { Coin } from "@/components/brand";
import { Group, GroupItem, GroupLabel } from "@/components/group";
import { habitIcon, HabitSheet } from "@/components/habit-sheet";
import { Icon, Txt } from "@/components/ui";
import { countNote, ruleNote, weekNote } from "@/lib/habits";
import { formatPaise } from "@/lib/money";
import { useForgetHabit, useHabits } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import type { Habit } from "@/lib/types";

function HabitRow({ h, first, onPress }: { h: Habit; first: boolean; onPress: () => void }) {
  const week = weekNote(h);
  return (
    <GroupItem
      first={first}
      leading={
        <View className="h-9 w-9 items-center justify-center rounded-full bg-bg">
          <Icon icon={habitIcon(h)} size={18} tone={h.over ? "danger" : "muted"} />
        </View>
      }
      title={h.label}
      subtitle={`${countNote(h)} · ${week ?? ruleNote(h.rule, h)}`}
      trailing={
        <View className="items-end">
          <Txt weight="semibold">{formatPaise(h.year_paise)}</Txt>
          <Txt tone="muted" className="text-xs">
            a year
          </Txt>
        </View>
      }
      onPress={onPress}
    />
  );
}

export default function HabitsScreen() {
  const { colors } = useTheme();
  const habits = useHabits();
  const forget = useForgetHabit();
  const [open, setOpen] = useState<string | null>(null);
  const data = habits.data;
  const habit = data?.items.find((h) => h.key === open) ?? null;

  if (!data) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        {habits.error ? <Txt tone="danger">{habits.error.message}</Txt> : <ActivityIndicator color={colors.muted} />}
      </View>
    );
  }

  const watched = data.items.filter((h) => h.rule?.status !== "keep");
  const fine = data.items.filter((h) => h.rule?.status === "keep");

  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        contentContainerClassName="px-5 pb-12 pt-4"
        refreshControl={<RefreshControl refreshing={habits.isRefetching} onRefresh={() => void habits.refetch()} />}
      >
        {data.items.length === 0 ? (
          <View className="items-center px-4 pt-10">
            <Coin size={64} variant="bare" mood="happy" />
            <Txt weight="semibold" className="mt-5 text-xl">
              No small habits spotted
            </Txt>
            <Txt tone="muted" className="mt-2 text-center text-base leading-6">
              Finlyt looks at the last 4 weeks for little things you buy on most days, like ice cream, a cold drink or
              chai. Groceries, rent, bills, medicine, getting around and meals never count.
            </Txt>
          </View>
        ) : (
          <>
            <Txt tone="muted" className="text-sm">
              Small habits, at the last 4 weeks&apos; pace
            </Txt>
            <Txt weight="bold" className="mt-1 text-5xl" style={{ letterSpacing: -1.2 }}>
              {formatPaise(data.total_year_paise)}
            </Txt>
            <Txt tone="muted" className="text-sm">
              a year · about {formatPaise(data.total_month_paise)} a month
            </Txt>

            {watched.length ? (
              <>
                <GroupLabel>Habits</GroupLabel>
                <Group>
                  {watched.map((h, i) => (
                    <HabitRow key={h.key} h={h} first={i === 0} onPress={() => setOpen(h.key)} />
                  ))}
                </Group>
              </>
            ) : null}
            {fine.length ? (
              <>
                <GroupLabel>Fine as they are</GroupLabel>
                <Group>
                  {fine.map((h, i) => (
                    <HabitRow key={h.key} h={h} first={i === 0} onPress={() => setOpen(h.key)} />
                  ))}
                </Group>
              </>
            ) : null}
          </>
        )}

        {data.needs.length ? (
          <>
            <GroupLabel>Needs, not habits</GroupLabel>
            <Group>
              {data.needs.map((n, i) => (
                <GroupItem
                  key={n.key}
                  first={i === 0}
                  title={n.label}
                  subtitle="Never counted as a habit"
                  trailing={
                    <View className="flex-row items-center gap-1">
                      <Icon icon={RotateCcw} size={14} tone="muted" />
                      <Txt tone="muted" className="text-sm">
                        Count it again
                      </Txt>
                    </View>
                  }
                  onPress={() => void forget.mutateAsync(n.key)}
                />
              ))}
            </Group>
          </>
        ) : null}

        <Txt tone="faint" className="mt-6 text-xs leading-4">
          A habit is something on the watch list (cigarettes, ice cream, cold drinks, chai and coffee, snacks, drinks)
          bought on 6 or more days in 4 weeks, or anything else small bought on 8 or more. Food delivery is only counted
          once you say how you use it.
        </Txt>
      </ScrollView>
      <HabitSheet habit={habit} onClose={() => setOpen(null)} />
    </View>
  );
}
