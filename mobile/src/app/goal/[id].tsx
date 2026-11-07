// One savings goal: a ring for how far you've got, what a month it takes, money in and out, and
// what you've put towards it.
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Minus, Pencil, Plus, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, ScrollView, TextInput, View } from "react-native";

import { Ring } from "@/components/charts";
import { GoalForm } from "@/components/goal-form";
import { Group, GroupItem, GroupLabel } from "@/components/group";
import { Button, Sheet, Txt } from "@/components/ui";
import { confirmDelete } from "@/lib/ask-sheet";
import { dateTimeLabel } from "@/lib/dates";
import { goalNote } from "@/lib/goals";
import { formatPaise } from "@/lib/money";
import { useDeleteGoal, useGoal, useGoalDeposit, useUpdateGoal } from "@/lib/queries";
import { fonts, useTheme } from "@/lib/theme";


export default function GoalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const goalId = Number(id);
  const { colors } = useTheme();
  const goal = useGoal(goalId);
  const deposit = useGoalDeposit();
  const update = useUpdateGoal();
  const remove = useDeleteGoal();
  const [moving, setMoving] = useState<"in" | "out" | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [round, setRound] = useState(0);
  const g = goal.data;

  if (!g) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        {goal.error ? <Txt tone="danger">{goal.error.message}</Txt> : <ActivityIndicator color={colors.muted} />}
      </View>
    );
  }

  async function move() {
    const rupees = parseInt(amount.replace(/\D/g, ""), 10);
    if (!(rupees > 0)) return;
    const ok = await deposit
      .mutateAsync({ id: goalId, amount_paise: (moving === "out" ? -1 : 1) * rupees * 100, note: note.trim() || undefined })
      .then(() => true)
      .catch(() => false);
    if (ok) {
      setMoving(null);
      setAmount("");
      setNote("");
    }
  }

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: g.name }} />
      <ScrollView contentContainerClassName="px-5 pb-12 pt-4">
        <View className="items-center">
          <Ring ratio={g.progress}>
            <Txt tone="muted" className="text-xs">
              Saved
            </Txt>
            <Txt weight="bold" className="mt-0.5 text-3xl" style={{ letterSpacing: -0.6 }}>
              {formatPaise(g.saved_paise)}
            </Txt>
            <Txt tone="muted" className="mt-0.5 text-xs">
              of {formatPaise(g.target_paise)}
            </Txt>
          </Ring>
          <Txt tone={g.done ? "accent" : "fg"} weight="medium" className="mt-4 text-center text-base">
            {goalNote(g)}
          </Txt>
          {g.saved_this_month_paise > 0 && !g.done ? (
            <Txt tone="muted" className="mt-1 text-sm">
              {formatPaise(g.saved_this_month_paise)} put in this month
            </Txt>
          ) : null}
        </View>

        <View className="mt-6 flex-row gap-3">
          <Button label="Add money" icon={Plus} onPress={() => setMoving("in")} className="flex-1" />
          <Button
            label="Take out"
            icon={Minus}
            variant="secondary"
            onPress={() => setMoving("out")}
            disabled={g.saved_paise === 0}
            className="flex-1"
          />
        </View>

        {g.deposits?.length ? (
          <>
            <GroupLabel>Money in and out</GroupLabel>
            <Group>
              {g.deposits.map((d, i) => (
                <GroupItem
                  key={d.id}
                  first={i === 0}
                  title={d.note ?? (d.amount_paise > 0 ? "Put in" : "Taken out")}
                  subtitle={dateTimeLabel(d.created_at)}
                  trailing={
                    <Txt weight="semibold" tone={d.amount_paise > 0 ? "accent" : "fg"}>
                      {d.amount_paise > 0 ? "+" : "−"}
                      {formatPaise(Math.abs(d.amount_paise))}
                    </Txt>
                  }
                />
              ))}
            </Group>
          </>
        ) : null}

        <GroupLabel>Goal</GroupLabel>
        <Group>
          <GroupItem
            first
            icon={Pencil}
            title="Change the goal"
            subtitle="Name, amount or date"
            onPress={() => {
              setRound((r) => r + 1);
              setEditing(true);
            }}
          />
          <GroupItem
            icon={Trash2}
            title="Delete goal"
            danger
            onPress={() =>
              confirmDelete(`Delete “${g.name}”?`, "The goal and its history go. Your entries aren't touched.", () =>
                void remove.mutateAsync(goalId).then(() => router.back()),
              )
            }
          />
        </Group>
      </ScrollView>

      <Sheet visible={moving !== null} onClose={() => setMoving(null)}>
        <Txt weight="semibold" className="text-xl">
          {moving === "out" ? "Take money out" : `Put money towards ${g.name}`}
        </Txt>
        <View className="mt-4 h-14 flex-row items-center rounded-2xl bg-surface px-4">
          <Txt weight="semibold" className="text-2xl">
            ₹
          </Txt>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            autoFocus
            placeholder="0"
            placeholderTextColor={colors.faint}
            className="ml-1 flex-1 text-2xl text-fg"
            style={{ fontFamily: fonts.semibold }}
          />
        </View>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Note (optional)"
          placeholderTextColor={colors.faint}
          className="mt-3 h-12 rounded-2xl bg-surface px-4 text-base text-fg"
          style={{ fontFamily: fonts.regular }}
        />
        {deposit.error ? (
          <Txt tone="danger" className="mt-3 text-sm">
            {deposit.error.message}
          </Txt>
        ) : null}
        <Button
          label={moving === "out" ? "Take out" : "Add"}
          onPress={() => void move()}
          loading={deposit.isPending}
          disabled={!(parseInt(amount.replace(/\D/g, ""), 10) > 0)}
          className="mt-5"
        />
      </Sheet>

      <GoalForm
        key={round}
        visible={editing}
        title="Change the goal"
        initial={{ name: g.name, target_paise: g.target_paise, due_on: g.due_on }}
        saving={update.isPending}
        error={update.error?.message ?? null}
        onClose={() => setEditing(false)}
        onSave={(next) => void update.mutateAsync({ id: goalId, ...next }).then(() => setEditing(false))}
      />
    </View>
  );
}
