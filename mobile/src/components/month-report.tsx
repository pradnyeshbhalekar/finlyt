// "Where did my money go": a month report, the way Claude's personal finance answers it. A compact
// card goes under Ask Finlyt's answer; the full report (its own screen) has every section: the
// total and how it compares, each day, where it went against your usual, money in and what's left,
// accounts, biggest spends, regular payments, money owed, and what's worth a look.
import { router } from "expo-router";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Lightbulb, Repeat } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { formatPaise } from "@/lib/money";
import type { MonthReport } from "@/lib/types";

import { DailyBars, Meter, RankedBars } from "./charts";
import { Icon, SectionLabel, Txt } from "./ui";

function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** "₹900 more than October at this point", with an arrow; or nothing to compare with. */
function Comparison({ r }: { r: MonthReport }) {
  const base = r.current ? r.last_month.same_point_paise : r.last_month.total_paise;
  if (!base) return null;
  const diff = r.spent_paise - base;
  const pct = Math.round((Math.abs(diff) / base) * 100);
  const up = diff > 0;
  return (
    <View className="mt-1 flex-row items-center gap-1">
      <Icon icon={up ? ArrowUpRight : ArrowDownRight} size={16} tone="muted" />
      <Txt tone="muted" className="text-sm">
        {diff === 0
          ? `The same as ${r.last_month.label}${r.current ? " at this point" : ""}`
          : `${formatPaise(Math.abs(diff))} ${up ? "more" : "less"} than ${r.last_month.label}${
              r.current ? " at this point" : ""
            } (${up ? "+" : "−"}${pct}%)`}
      </Txt>
    </View>
  );
}

function categoryRows(r: MonthReport, limit?: number) {
  const rows = r.categories.map((c) => ({
    key: String(c.category_id ?? c.name),
    label: `${c.name} · ${Math.round(c.share * 100)}%`,
    paise: c.spent_paise,
    usualPaise: c.usual_paise,
    detail:
      c.usual_paise && r.current && c.pace_paise > c.usual_paise * 1.15
        ? `On pace for ${formatPaise(c.pace_paise)}, usually ${formatPaise(c.usual_paise)}`
        : undefined,
  }));
  if (!limit || rows.length <= limit) return rows;
  const rest = rows.slice(limit - 1);
  return [
    ...rows.slice(0, limit - 1),
    { key: "other", label: `${rest.length} more`, paise: rest.reduce((sum, x) => sum + x.paise, 0), usualPaise: null, detail: undefined },
  ];
}

/** The compact version, under Ask Finlyt's answer. */
export function ReportCard({ report: r }: { report: MonthReport }) {
  return (
    <View className="mb-3 ml-9 rounded-3xl border border-line p-4">
      <Txt tone="muted" className="text-sm">
        {r.label}
        {r.current ? `, so far (${r.days_counted} days)` : ""}
      </Txt>
      <Txt weight="bold" className="mt-1 text-4xl" style={{ letterSpacing: -0.8 }}>
        {formatPaise(r.spent_paise)}
      </Txt>
      <Comparison r={r} />
      {r.categories.length > 0 ? (
        <View className="mt-4">
          <RankedBars rows={categoryRows(r, 4)} />
        </View>
      ) : (
        <Txt tone="muted" className="mt-3 text-sm">
          Nothing logged this month yet.
        </Txt>
      )}
      {r.notes.slice(1, 3).map((n, i) => (
        <Txt key={i} tone="muted" className="mt-3 text-sm leading-5">
          {n}
        </Txt>
      ))}
      <Pressable
        onPress={() => router.push({ pathname: "/report", params: { month: r.month } })}
        accessibilityRole="button"
        className="mt-4 flex-row items-center justify-between rounded-2xl bg-surface px-4 py-3 active:opacity-70"
      >
        <Txt weight="semibold">See the full report</Txt>
        <Icon icon={ChevronRight} size={18} tone="muted" />
      </Pressable>
    </View>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View className="flex-1 rounded-2xl bg-surface p-3">
      <Txt tone="muted" className="text-xs">
        {label}
      </Txt>
      <Txt weight="semibold" className="mt-1 text-lg">
        {value}
      </Txt>
      {hint ? (
        <Txt tone="muted" className="mt-0.5 text-xs">
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-9">
      <SectionLabel className="mb-3">{title}</SectionLabel>
      {children}
    </View>
  );
}

/** The full report. */
export function ReportView({ report: r }: { report: MonthReport }) {
  const income = r.money_in.income_source === "bank" ? r.money_in.income_paise : r.money_in.salary_paise;
  const left = r.money_in.left_paise;
  const saved = r.money_in.saved_share;
  const limit = r.budget.plan?.daily_limit_paise ?? null;
  return (
    <View>
      <Txt tone="muted" className="text-sm">
        {r.current ? `So far, ${r.days_counted} of ${r.days_in_month} days` : `${r.days_in_month} days`}
      </Txt>
      <Txt weight="bold" className="mt-1 text-5xl" style={{ letterSpacing: -1 }}>
        {formatPaise(r.spent_paise)}
      </Txt>
      <Comparison r={r} />
      <Txt tone="muted" className="mt-1 text-sm">
        {formatPaise(r.per_day_paise)} a day
        {r.current ? ` · on pace for ${formatPaise(r.pace_paise)}` : ""}
        {r.usual.months ? ` · usually ${formatPaise(r.usual.total_paise)} a month` : ""}
      </Txt>
      {r.budget.budget_paise ? (
        <View className="mt-4">
          <Meter ratio={r.spent_paise / r.budget.budget_paise} />
          <Txt tone="muted" className="mt-1.5 text-xs">
            {formatPaise(r.spent_paise)} of your {formatPaise(r.budget.budget_paise)} budget
            {r.budget.days_over_limit ? ` · over the day's limit on ${r.budget.days_over_limit} days` : ""}
          </Txt>
        </View>
      ) : null}

      <Section title="Money in and out">
        <View className="flex-row gap-2">
          <Tile
            label={r.money_in.income_source === "bank" ? "Income" : "Monthly income"}
            value={income ? formatPaise(income) : "Not known"}
            hint={r.money_in.income_source === "memory" ? "what you told Finlyt" : income ? undefined : "tell Finlyt in Ask"}
          />
          <Tile label={r.current ? "Spent, on pace" : "Spent"} value={formatPaise(r.current ? r.pace_paise : r.spent_paise)} />
          <Tile
            label="Left"
            value={left === null ? "–" : formatPaise(left)}
            hint={saved === null ? undefined : `${Math.round(saved * 100)}% of income`}
          />
        </View>
        {r.money_in.commitments_paise ? (
          <Txt tone="muted" className="mt-2 text-xs">
            Commitments take {formatPaise(r.money_in.commitments_paise)} a month of that.
          </Txt>
        ) : null}
        {r.money_in.paybacks_paise ? (
          <Txt tone="muted" className="mt-1 text-xs">
            Paid back to you: {formatPaise(r.money_in.paybacks_paise)}
          </Txt>
        ) : null}
      </Section>

      <Section title="Each day">
        <DailyBars days={r.by_day} limitPaise={limit} />
      </Section>

      {r.categories.length > 0 ? (
        <Section title="Where it went">
          <RankedBars rows={categoryRows(r, 8)} />
        </Section>
      ) : null}

      {r.paid_from.length > 0 ? (
        <Section title="Paid from">
          <RankedBars showUsual={false} rows={r.paid_from.map((a) => ({ key: String(a.account_id), label: a.name, paise: a.paid_paise }))} />
        </Section>
      ) : null}

      {r.biggest.length > 0 ? (
        <Section title="Biggest spends">
          {r.biggest.map((b) => (
            <Pressable
              key={b.expense_id}
              onPress={() => router.push({ pathname: "/expense/[id]", params: { id: String(b.expense_id) } })}
              className="flex-row items-center gap-3 py-2 active:opacity-70"
            >
              <View className="flex-1">
                <Txt weight="medium" numberOfLines={1}>
                  {b.description}
                </Txt>
                <Txt tone="muted" className="text-xs">
                  {shortDay(b.day)} · {b.category}
                </Txt>
              </View>
              <Txt weight="semibold">{formatPaise(b.my_share_paise)}</Txt>
            </Pressable>
          ))}
        </Section>
      ) : null}

      {r.regular.length > 0 ? (
        <Section title="Regular payments">
          {r.regular.map((x) => (
            <View key={x.description} className="flex-row items-center gap-3 py-2">
              <Icon icon={Repeat} size={18} tone="muted" />
              <View className="flex-1">
                <Txt weight="medium" numberOfLines={1}>
                  {x.description}
                </Txt>
                <Txt tone="muted" className="text-xs">
                  {x.months} of the last 3 months · last on {shortDay(x.last_day)}
                </Txt>
              </View>
              <Txt weight="semibold">{formatPaise(x.typical_paise)}</Txt>
            </View>
          ))}
        </Section>
      ) : null}

      {r.owed.to_me_paise || r.owed.i_owe_paise ? (
        <Section title="Owed">
          <Pressable onPress={() => router.push("/owed")} className="flex-row gap-2 active:opacity-70">
            <Tile label="Owed to you" value={formatPaise(r.owed.to_me_paise)} />
            <Tile label="You owe" value={formatPaise(r.owed.i_owe_paise)} />
          </Pressable>
        </Section>
      ) : null}

      {r.notes.length > 0 ? (
        <Section title="Worth a look">
          {r.notes.map((n, i) => (
            <View key={i} className="mb-2.5 flex-row gap-2.5">
              <Icon icon={Lightbulb} size={16} tone="muted" />
              <Txt className="flex-1 text-sm leading-5">{n}</Txt>
            </View>
          ))}
        </Section>
      ) : null}
    </View>
  );
}
