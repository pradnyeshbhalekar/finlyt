// How much to save a month. Finlyt suggests 20% of what's left of your income after commitments
// (from what it remembers); you can set your own. The screen checks it against what you usually
// spend (or this month's budget), what your goals need, what small habits cost, and this month.
import { router } from "expo-router";
import { BookmarkCheck, Pencil, Repeat, Target } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, ScrollView, TextInput, View } from "react-native";

import { Coin } from "@/components/brand";
import { Group, GroupItem, GroupLabel } from "@/components/group";
import { Button, Sheet, Txt } from "@/components/ui";
import { formatPaise } from "@/lib/money";
import { useSavingPlan, useSetIncome, useSetSavingTarget } from "@/lib/queries";
import { fonts, useTheme } from "@/lib/theme";

function RupeeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <View className="mt-4 h-14 flex-row items-center rounded-2xl bg-surface px-4">
      <Txt weight="semibold" className="text-2xl">
        ₹
      </Txt>
      <TextInput
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^\d]/g, ""))}
        keyboardType="number-pad"
        autoFocus
        accessibilityLabel={label}
        className="ml-1 flex-1 py-0 text-2xl text-fg"
        style={{ fontFamily: fonts.semibold }}
      />
    </View>
  );
}

function Line({ label, value, strong = false, first = false }: { label: string; value: string; strong?: boolean; first?: boolean }) {
  return (
    <GroupItem
      first={first}
      title={label}
      trailing={
        <Txt weight={strong ? "bold" : "semibold"} className={strong ? "text-lg" : "text-base"}>
          {value}
        </Txt>
      }
    />
  );
}

export default function SavingScreen() {
  const { colors } = useTheme();
  const plan = useSavingPlan();
  const setTarget = useSetSavingTarget();
  const setIncome = useSetIncome();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [income, setIncomeText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const p = plan.data;

  if (!p) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        {plan.error ? <Txt tone="danger">{plan.error.message}</Txt> : <ActivityIndicator color={colors.muted} />}
      </View>
    );
  }

  async function saveIncome() {
    const rupees = parseInt(income, 10);
    if (!(rupees > 0)) return;
    setError(null);
    try {
      await setIncome.mutateAsync(rupees * 100);
      await plan.refetch();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveTarget(paise: number | null) {
    setError(null);
    try {
      await setTarget.mutateAsync(paise);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (p.needs_income) {
    return (
      <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-6 pb-12 pt-8" keyboardShouldPersistTaps="handled">
        <Coin size={56} variant="bare" mood="thinking" />
        <Txt weight="bold" className="mt-5 text-2xl">
          How much do you take home a month?
        </Txt>
        <Txt tone="muted" className="mt-2 text-base leading-6">
          Finlyt suggests saving 20% of what&apos;s left after your monthly commitments, and checks that your spending
          leaves room for it. Only you see this.
        </Txt>
        <RupeeInput value={income} onChange={setIncomeText} label="Monthly take-home income" />
        {error ? (
          <Txt tone="danger" className="mt-2 text-sm">
            {error}
          </Txt>
        ) : null}
        <Button
          label="Work out my saving"
          onPress={() => void saveIncome()}
          loading={setIncome.isPending}
          disabled={!(parseInt(income, 10) > 0)}
          className="mt-4"
        />
      </ScrollView>
    );
  }

  const target = p.target_paise ?? 0;
  const month = new Date().toLocaleDateString("en-IN", { month: "long" });
  const spendingLabel = p.spending_basis === "budget" ? `${month} budget` : "Usual spending and commitments";

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="px-5 pb-12 pt-4">
        <Txt tone="muted" className="text-sm">
          Save each month
        </Txt>
        <Txt weight="bold" className="mt-1 text-5xl" style={{ letterSpacing: -1.2 }}>
          {formatPaise(target)}
        </Txt>
        <Txt tone="muted" className="text-sm">
          {p.target_is_set
            ? `Your own target · 20% would be ${formatPaise(p.suggested_paise ?? 0)}`
            : "20% of what's left after commitments"}
        </Txt>
        <Button
          label="Change it"
          icon={Pencil}
          variant="secondary"
          onPress={() => {
            setAmount(String(Math.round(target / 100)));
            setError(null);
            setEditing(true);
          }}
          className="mt-4 self-start"
        />

        <View className="mt-5 rounded-3xl bg-surface p-4">
          {p.fits === null ? (
            <Txt tone="muted" className="text-base leading-6">
              Log a few weeks and Finlyt will check your spending leaves room for it.
            </Txt>
          ) : p.fits ? (
            <Txt className="text-base leading-6">
              <Txt weight="semibold" tone="accent">
                It fits.
              </Txt>{" "}
              {p.spending_basis === "budget" ? "Your budget" : "Your usual spending"} leaves {formatPaise(p.room_paise ?? 0)} a
              month, {formatPaise((p.room_paise ?? 0) - target)} more than the target.
            </Txt>
          ) : (
            <Txt className="text-base leading-6">
              <Txt weight="semibold" tone="warn">
                {formatPaise(p.short_paise ?? 0)} short.
              </Txt>{" "}
              {p.spending_basis === "budget" ? "Your budget" : "Your usual spending"} leaves{" "}
              {formatPaise(Math.max(p.room_paise ?? 0, 0))} a month.
              {p.habits_half_paise > 0
                ? ` Halving your small habits would free about ${formatPaise(p.habits_half_paise)} a month.`
                : ""}
            </Txt>
          )}
        </View>

        <GroupLabel>How it adds up, a month</GroupLabel>
        <Group>
          <Line first label="Take-home income" value={formatPaise(p.monthly_income_paise ?? 0)} />
          {p.spending_basis === "usual" && p.committed_paise ? (
            <Line label="Commitments" value={`−${formatPaise(p.committed_paise)}`} />
          ) : null}
          {p.spending_paise != null ? (
            <Line
              label={p.spending_basis === "usual" ? `Usual spending (${p.usual_months} ${p.usual_months === 1 ? "month" : "months"})` : spendingLabel}
              value={`−${formatPaise(p.spending_basis === "usual" ? p.spending_paise - p.committed_paise : p.spending_paise)}`}
            />
          ) : null}
          {p.room_paise != null ? <Line label="Left to save" value={formatPaise(p.room_paise)} strong /> : null}
        </Group>

        <GroupLabel>{month} so far</GroupLabel>
        <Group>
          <Line first label="Spent" value={formatPaise(p.month.spent_paise)} />
          {p.month.left_to_spend_paise != null ? (
            <GroupItem
              title="Left to spend"
              subtitle={
                p.month.left_to_spend_paise > 0
                  ? `and still save ${formatPaise(target)}: about ${formatPaise(p.month.per_day_paise ?? 0)} a day for ${p.month.days_left} ${p.month.days_left === 1 ? "day" : "days"}`
                  : `Spending has gone past what saving ${formatPaise(target)} leaves`
              }
              trailing={
                <Txt weight="semibold" tone={p.month.left_to_spend_paise < 0 ? "danger" : "fg"}>
                  {formatPaise(Math.abs(p.month.left_to_spend_paise))}
                  {p.month.left_to_spend_paise < 0 ? " over" : ""}
                </Txt>
              }
            />
          ) : null}
        </Group>

        <GroupLabel>Where it could go</GroupLabel>
        <Group>
          {p.goals.map((g, i) => (
            <GroupItem
              key={g.id}
              first={i === 0}
              icon={Target}
              title={g.name}
              subtitle={g.monthly_needed_paise ? `${formatPaise(g.monthly_needed_paise)} a month to get there in time` : `${formatPaise(g.left_paise)} to go`}
              onPress={() => router.push({ pathname: "/goal/[id]", params: { id: String(g.id) } })}
            />
          ))}
          <GroupItem
            first={p.goals.length === 0}
            icon={Repeat}
            title="Small habits"
            subtitle={
              p.habits_month_paise > 0
                ? `About ${formatPaise(p.habits_month_paise)} a month${p.top_habit ? `, most on ${p.top_habit.label.toLowerCase()}` : ""}${p.habits_saved_paise ? ` · limits saved ${formatPaise(p.habits_saved_paise)}` : ""}`
                : "None spotted in the last 4 weeks"
            }
            onPress={() => router.push("/habits")}
          />
          <GroupItem icon={BookmarkCheck} title="Income and commitments" subtitle="What Finlyt remembers" onPress={() => router.push("/memory")} />
        </Group>
        {p.goals_need_more ? (
          <Txt tone="warn" className="mt-2 px-1 text-sm leading-5">
            Your goals need {formatPaise(p.goals_monthly_paise)} a month together, more than the target.
          </Txt>
        ) : null}
      </ScrollView>

      <Sheet visible={editing} onClose={() => setEditing(false)}>
        <Txt weight="semibold" className="text-xl">
          How much a month?
        </Txt>
        <Txt tone="muted" className="mt-1 text-sm">
          Finlyt&apos;s suggestion is {formatPaise(p.suggested_paise ?? 0)}: 20% of what&apos;s left after commitments.
        </Txt>
        <RupeeInput value={amount} onChange={setAmount} label="Monthly saving target" />
        {error ? (
          <Txt tone="danger" className="mt-2 text-sm">
            {error}
          </Txt>
        ) : null}
        <Button
          label="Save"
          onPress={() => void saveTarget(parseInt(amount, 10) * 100)}
          loading={setTarget.isPending}
          disabled={!(parseInt(amount, 10) > 0)}
          className="mt-4"
        />
        {p.target_is_set ? (
          <Button label="Use the suggestion" variant="ghost" onPress={() => void saveTarget(null)} className="mt-1" />
        ) : null}
      </Sheet>
    </View>
  );
}
