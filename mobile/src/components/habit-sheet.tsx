// One small habit in a sheet: how often and what it adds up to in a year, what a limit would
// save, and what you decide about it: a limit, it's fine, or it's a need. Food delivery asks how
// you use it first: as meals it gets a weekly budget, as treats a limit like any habit.
import { Bike, Candy, Cigarette, Coffee, Cookie, CupSoda, IceCreamCone, Leaf, Repeat, Wine } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { countNote, limitChoices, ruleNote, weekNote, yearlySaving } from "@/lib/habits";
import { formatPaise } from "@/lib/money";
import { useDecideHabit, useForgetHabit, useGoalDeposit, useGoals } from "@/lib/queries";
import type { Habit, HabitDecision } from "@/lib/types";

import { AmountStepper, CountStepper } from "./steppers";
import { Button, Icon, Sheet, Txt, type IconType } from "./ui";

const ICONS: Record<string, IconType> = {
  cigarettes: Cigarette,
  tobacco: Leaf,
  drinks: Wine,
  "ice cream": IceCreamCone,
  chocolate: Candy,
  "cold drinks": CupSoda,
  chai: Coffee,
  snacks: Cookie,
  "food delivery": Bike,
};

export function habitIcon(h: Pick<Habit, "key">): IconType {
  return ICONS[h.key] ?? Repeat;
}

/** A small pill to pick, with a note under the label (what a choice saves a year). */
function Pick({ label, note, selected, onPress }: { label: string; note?: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`mb-2 mr-2 rounded-2xl px-3 py-2 ${selected ? "bg-brand" : "bg-surface"}`}
    >
      <Txt weight="medium" tone={selected ? "onBrand" : "fg"} className="text-sm">
        {label}
      </Txt>
      {note ? (
        <Txt tone={selected ? "onBrand" : "muted"} className="text-xs">
          {note}
        </Txt>
      ) : null}
    </Pressable>
  );
}

export function HabitSheet({ habit, onClose }: { habit: Habit | null; onClose: () => void }) {
  const rule = habit?.rule;
  return (
    <Sheet visible={habit !== null} onClose={onClose}>
      {habit ? (
        // A new key whenever the habit or its decision changes, so the pickers start from it.
        <HabitBody
          key={`${habit.key}:${rule?.status}:${rule?.times_per_week}:${rule?.paise_per_week}`}
          h={habit}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  );
}

function HabitBody({ h, onClose }: { h: Habit; onClose: () => void }) {
  const decide = useDecideHabit();
  const forget = useForgetHabit();
  const deposit = useGoalDeposit();
  const goals = useGoals();
  const goal = (goals.data?.items ?? []).find((g) => !g.archived && !g.done);
  const rule = h.rule;
  // Food delivery as meals (or both) has a weekly budget; as treats, a limit like any habit.
  const usesBudget = h.kind === "delivery" && rule?.times_per_week == null;
  const [perWeek, setPerWeek] = useState(rule?.times_per_week ?? Math.max(0, Math.min(3, Math.floor(h.per_week / 2))));
  const [budget, setBudget] = useState(rule?.paise_per_week ?? h.suggested_budget_paise ?? 50000);
  const [error, setError] = useState<string | null>(null);
  const [put, setPut] = useState(false);

  async function choose(decision: HabitDecision) {
    setError(null);
    try {
      await decide.mutateAsync({ key: h.key, ...decision });
      if (decision.status !== "limit") onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function putInGoal(amount: number) {
    if (!goal) return;
    try {
      await deposit.mutateAsync({ id: goal.id, amount_paise: amount, note: `Less ${h.label.toLowerCase()}` });
      setPut(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const busy = decide.isPending || forget.isPending;
  const saving = yearlySaving(h, perWeek);
  const week = weekNote(h);

  return (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-surface">
          <Icon icon={habitIcon(h)} size={20} tone="muted" />
        </View>
        <View className="flex-1">
          <Txt weight="semibold" className="text-xl">
            {h.label}
          </Txt>
          <Txt tone="muted" className="text-sm">
            {countNote(h)}
            {h.typical_paise ? ` · usually ${formatPaise(h.typical_paise)}` : ""}
          </Txt>
        </View>
      </View>

      <Txt tone="muted" className="mt-5 text-sm">
        At this pace, in a year
      </Txt>
      <Txt weight="bold" className="text-4xl" style={{ letterSpacing: -1 }}>
        {formatPaise(h.year_paise)}
      </Txt>
      <Txt tone="muted" className="text-sm">
        about {formatPaise(h.month_paise)} a month
        {h.previous_paise ? ` · ${formatPaise(h.previous_paise)} in the 4 weeks before` : ""}
      </Txt>

      {rule?.status === "limit" ? (
        <View className="mt-4 rounded-2xl bg-surface px-4 py-3">
          <Txt weight="medium" tone={h.over ? "warn" : "fg"}>
            {ruleNote(rule, h)}
            {week ? ` · ${week}` : ""}
          </Txt>
          {h.saved_last_week_paise != null ? (
            <Txt tone="muted" className="mt-1 text-sm">
              Last week cost {formatPaise(h.saved_last_week_paise)} less than before
              {h.saved_paise ? `, ${formatPaise(h.saved_paise)} saved since you set it` : ""}.
            </Txt>
          ) : (
            <Txt tone="muted" className="mt-1 text-sm">
              What it saves shows here after a full week.
            </Txt>
          )}
          {goal && h.saved_last_week_paise ? (
            <Button
              label={put ? `Put in ${goal.name}` : `Put ${formatPaise(h.saved_last_week_paise)} in ${goal.name}`}
              variant="secondary"
              disabled={put}
              loading={deposit.isPending}
              onPress={() => void putInGoal(h.saved_last_week_paise ?? 0)}
              className="mt-3"
            />
          ) : null}
        </View>
      ) : null}

      {h.kind === "delivery" && h.needs_answer ? (
        <>
          <Txt weight="semibold" className="mt-6 text-base">
            How do you use food delivery?
          </Txt>
          <Txt tone="muted" className="mt-1 text-sm leading-5">
            If it&apos;s how you get your meals, it&apos;s not a habit: Finlyt keeps a weekly budget and tells you
            when you go over, or when an order is much bigger than usual.
          </Txt>
          <View className="mt-3 gap-2">
            <Button
              label="It's how I get my meals"
              variant="secondary"
              disabled={busy}
              onPress={() =>
                void choose({
                  status: "limit",
                  paise_per_week: h.suggested_budget_paise ?? budget,
                  note: "Orders food delivery for most meals",
                })
              }
            />
            <Button
              label="Mostly treats"
              variant="secondary"
              disabled={busy}
              onPress={() => void choose({ status: "limit", times_per_week: Math.max(1, Math.floor(h.per_week / 2)) })}
            />
            <Button
              label="Both"
              variant="secondary"
              disabled={busy}
              onPress={() => void choose({ status: "limit", paise_per_week: h.suggested_budget_paise ?? budget })}
            />
          </View>
        </>
      ) : usesBudget ? (
        <>
          <Txt weight="semibold" className="mt-6 text-base">
            Weekly budget
          </Txt>
          <AmountStepper label="Food delivery" hint="a week" paise={budget} min={10000} step={10000} onChange={setBudget} />
          <Button
            label={rule?.paise_per_week === budget ? "Budget set" : "Set this budget"}
            disabled={busy || rule?.paise_per_week === budget}
            loading={decide.isPending}
            onPress={() => void choose({ status: "limit", paise_per_week: budget })}
            className="mt-2"
          />
        </>
      ) : (
        <>
          <Txt weight="semibold" className="mt-6 text-base">
            {rule?.status === "limit" ? "Change the limit" : "What if you cut down?"}
          </Txt>
          <View className="mt-3 flex-row flex-wrap">
            {limitChoices(h).map((c) => (
              <Pick
                key={c.perWeek}
                label={c.label}
                note={`saves ${formatPaise(yearlySaving(h, c.perWeek))} a year`}
                selected={perWeek === c.perWeek}
                onPress={() => setPerWeek(c.perWeek)}
              />
            ))}
          </View>
          <CountStepper label="Times a week" hint="0 to stop" value={perWeek} max={21} onChange={setPerWeek} />
          <Txt tone="muted" className="text-sm leading-5">
            {saving > 0
              ? `About ${formatPaise(saving)} a year saved${goal ? `, money that could go to ${goal.name}` : ""}.`
              : "That's about as often as now."}
          </Txt>
          <Button
            label={rule?.status === "limit" && rule.times_per_week === perWeek ? "Limit set" : "Set this limit"}
            disabled={busy || (rule?.status === "limit" && rule.times_per_week === perWeek)}
            loading={decide.isPending}
            onPress={() => void choose({ status: "limit", times_per_week: perWeek })}
            className="mt-3"
          />
        </>
      )}

      <View className="mt-3 flex-row gap-3">
        {rule?.status !== "keep" ? (
          <Button label="It's fine" variant="secondary" disabled={busy} onPress={() => void choose({ status: "keep" })} className="flex-1" />
        ) : null}
        <Button label="It's a need" variant="secondary" disabled={busy} onPress={() => void choose({ status: "need" })} className="flex-1" />
      </View>
      {rule ? (
        <Button
          label="Forget my decision"
          variant="ghost"
          disabled={busy}
          onPress={() =>
            void forget
              .mutateAsync(h.key)
              .then(onClose)
              .catch((e: Error) => setError(e.message))
          }
          className="mt-1"
        />
      ) : null}
      {error ? (
        <Txt tone="danger" className="mt-2 text-sm">
          {error}
        </Txt>
      ) : null}
      <Txt tone="faint" className="mb-2 mt-3 text-xs leading-4">
        From the last 4 weeks. With a limit, Finlyt adds a line after you log it if you go past it (Settings → Habit
        alerts).
      </Txt>
    </ScrollView>
  );
}
