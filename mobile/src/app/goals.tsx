// Savings goals: each one with how much is saved and what a month it takes; tap one to put money
// towards it. "New goal" starts one (also opened as /goals?new=1).
import { router, useLocalSearchParams } from "expo-router";
import { Plus, Target } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";

import { Meter } from "@/components/charts";
import { GoalForm } from "@/components/goal-form";
import { Button, Icon, Txt } from "@/components/ui";
import { goalNote } from "@/lib/goals";
import { formatPaise } from "@/lib/money";
import { useCreateGoal, useGoals } from "@/lib/queries";
import { useTheme } from "@/lib/theme";

export default function Goals() {
  const { new: startNew } = useLocalSearchParams<{ new?: string }>();
  const { colors } = useTheme();
  const goals = useGoals();
  const create = useCreateGoal();
  const [adding, setAdding] = useState(startNew === "1");
  const [round, setRound] = useState(0);
  const items = (goals.data?.items ?? []).filter((g) => !g.archived);

  async function save(goal: { name: string; target_paise: number; due_on: string | null }) {
    const g = await create.mutateAsync(goal).catch(() => null);
    if (g) {
      setAdding(false);
      router.push({ pathname: "/goal/[id]", params: { id: String(g.id) } });
    }
  }

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="px-5 pb-12 pt-2">
        {goals.isPending ? (
          <View className="mt-16 items-center">
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : items.length === 0 ? (
          <View className="mt-12 items-center px-4">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-surface">
              <Icon icon={Target} size={26} tone="accent" />
            </View>
            <Txt weight="semibold" className="mt-4 text-xl">
              Save up for something
            </Txt>
            <Txt tone="muted" className="mt-2 text-center text-base leading-6">
              A trip, a new phone, an emergency fund. Finlyt shows how far you&apos;ve got and what a month it takes.
            </Txt>
          </View>
        ) : (
          <View className="gap-3">
            {items.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => router.push({ pathname: "/goal/[id]", params: { id: String(g.id) } })}
                accessibilityRole="button"
                className="rounded-3xl bg-surface p-4 active:opacity-80"
              >
                <View className="flex-row items-baseline justify-between">
                  <Txt weight="semibold" className="flex-1 text-base" numberOfLines={1}>
                    {g.name}
                  </Txt>
                  <Txt tone="muted" className="text-sm">
                    {Math.round(g.progress * 100)}%
                  </Txt>
                </View>
                <Txt weight="bold" className="mt-1 text-2xl">
                  {formatPaise(g.saved_paise)}
                  <Txt tone="muted" className="text-base">
                    {" "}
                    of {formatPaise(g.target_paise)}
                  </Txt>
                </Txt>
                <View className="mt-3">
                  <Meter ratio={g.progress} />
                </View>
                <Txt tone={g.done ? "accent" : "muted"} className="mt-2 text-sm">
                  {goalNote(g)}
                </Txt>
              </Pressable>
            ))}
          </View>
        )}
        <Button
          label="New goal"
          icon={Plus}
          variant={items.length ? "secondary" : "primary"}
          onPress={() => {
            setRound((r) => r + 1);
            setAdding(true);
          }}
          className="mt-6"
        />
      </ScrollView>
      <GoalForm
        key={round}
        visible={adding}
        title="New goal"
        saving={create.isPending}
        error={create.error?.message ?? null}
        onClose={() => setAdding(false)}
        onSave={(goal) => void save(goal)}
      />
    </View>
  );
}
