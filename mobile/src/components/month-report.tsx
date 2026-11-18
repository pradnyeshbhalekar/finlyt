// "Where did my money go": a month report, the way Claude's personal finance answers it. A compact
// card goes under Ask Finlyt's answer; the full report (its own screen) has every section: the
// total and how it compares, each day, where it went against your usual, money in and what's left,
// accounts, biggest spends, regular payments, small habits, money owed, and what's worth a look. Each number and
// section has an ⓘ that explains it with this month's own figures (lib/report-help).
import { router } from "expo-router";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Lightbulb, Repeat } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { formatPaise } from "@/lib/money";
import { reportHelp, type HelpKey } from "@/lib/report-help";
import type { MonthReport } from "@/lib/types";

import { DailyBars, RankedBars, Ring } from "./charts";
import { habitIcon } from "./habit-sheet";
import { InfoButton, InfoSheet } from "./info";
import { Icon, SectionLabel, Txt } from "./ui";

function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** A habit against last month: more or less for a past month; while this month is still going,
 *  last month's whole amount (a part of a month against a whole one would always look better). */
function againstLastMonth(r: MonthReport, spent: number, previous: number): string {
  const last = r.habits?.previous_label ?? r.last_month.label;
  if (!previous) return `none in ${last}`;
  if (r.current) return `${formatPaise(previous)} in all of ${last}`;
  if (spent === previous) return `same as ${last}`;
  return `${formatPaise(Math.abs(spent - previous))} ${spent > previous ? "more" : "less"} than ${last}`;
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

function openCategory(r: MonthReport, id: number | null, name: string) {
  if (id == null) return undefined;
  return () => router.push({ pathname: "/category", params: { month: r.month, category_id: String(id), name } });
}

function categoryRows(r: MonthReport, limit?: number, onMore?: () => void) {
  const rows = r.categories.map((c) => ({
    key: String(c.category_id ?? c.name),
    label: `${c.name} · ${Math.round(c.share * 100)}%`,
    paise: c.spent_paise,
    usualPaise: c.usual_paise,
    detail: undefined as string | undefined,
    onPress: openCategory(r, c.category_id, c.name),
  }));
  if (!limit || rows.length <= limit) return rows;
  const rest = rows.slice(limit - 1);
  return [
    ...rows.slice(0, limit - 1),
    {
      key: "other",
      label: `${rest.length} more`,
      paise: rest.reduce((sum, x) => sum + x.paise, 0),
      usualPaise: null,
      detail: undefined,
      onPress: onMore,
    },
  ];
}

/** The compact version, under Ask Finlyt's answer. */
export function ReportCard({ report: r }: { report: MonthReport }) {
  return (
    <View className="mb-3 rounded-3xl border border-line p-4">
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

function Tile({ label, value, hint, info }: { label: string; value: string; hint?: string; info?: () => void }) {
  return (
    <View className="flex-1 rounded-2xl bg-surface p-3">
      <View className="flex-row items-center gap-1">
        <Txt tone="muted" className="shrink text-xs" numberOfLines={1}>
          {label}
        </Txt>
        {info ? <InfoButton label={label} onPress={info} /> : null}
      </View>
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

function Section({ title, info, children }: { title: string; info?: () => void; children: React.ReactNode }) {
  return (
    <View className="mt-9">
      <View className="mb-3 flex-row items-center gap-1.5">
        <SectionLabel>{title}</SectionLabel>
        {info ? <InfoButton label={title} onPress={info} /> : null}
      </View>
      {children}
    </View>
  );
}

/** The full report. */
export function ReportView({ report: r }: { report: MonthReport }) {
  const [allCategories, setAllCategories] = useState(false);
  // Which ⓘ is open; `topic` stays set while its sheet fades out.
  const [helpOpen, setHelpOpen] = useState(false);
  const [topic, setTopic] = useState<HelpKey>("spent");
  const explain = (key: HelpKey) => () => {
    setTopic(key);
    setHelpOpen(true);
  };
  const income = r.money_in.income_source === "bank" ? r.money_in.income_paise : r.money_in.salary_paise;
  const left = r.money_in.left_paise;
  const saved = r.money_in.saved_share;
  const limit = r.budget.plan?.daily_limit_paise ?? null;
  const budget = r.budget.budget_paise;
  const over = budget ? r.spent_paise - budget : 0;
  const days = r.current ? `${r.days_counted} of ${r.days_in_month} days` : `${r.days_in_month} days`;
  return (
    <View>
      <View className="items-center">
        {budget ? (
          <Ring ratio={r.spent_paise / budget} over={over > 0}>
            <View className="flex-row items-center gap-1">
              <Txt tone="muted" className="text-xs">
                {r.current ? "Spent so far" : "Spent"}
              </Txt>
              <InfoButton label={r.current ? "Spent so far" : "Spent"} onPress={explain("spent")} />
            </View>
            <Txt weight="bold" className="mt-0.5 text-3xl" style={{ letterSpacing: -0.6 }}>
              {formatPaise(r.spent_paise)}
            </Txt>
            <Txt tone={over > 0 ? "danger" : "muted"} className="mt-0.5 text-xs">
              {over > 0 ? `${formatPaise(over)} over budget` : `of ${formatPaise(budget)}`}
            </Txt>
          </Ring>
        ) : (
          <View className="flex-row items-center gap-2">
            <Txt weight="bold" className="text-5xl" style={{ letterSpacing: -1 }}>
              {formatPaise(r.spent_paise)}
            </Txt>
            <InfoButton label={r.current ? "Spent so far" : "Spent"} onPress={explain("spent")} />
          </View>
        )}
        <Txt tone="muted" className="mt-3 text-sm">
          {days}
        </Txt>
        <Comparison r={r} />
      </View>
      <View className="mt-6 flex-row gap-2">
        <Tile label="A day" value={formatPaise(r.per_day_paise)} info={explain("perDay")} />
        {r.current ? <Tile label="On pace for" value={formatPaise(r.pace_paise)} info={explain("pace")} /> : null}
        {r.usual.months ? (
          <Tile label="Usually" value={formatPaise(r.usual.total_paise)} hint="a month" info={explain("usual")} />
        ) : null}
      </View>

      <Section title="Money in and out">
        <View className="flex-row gap-2">
          <Tile
            label={r.money_in.income_source === "bank" ? "Income" : "Monthly income"}
            value={income ? formatPaise(income) : "Not known"}
            hint={r.money_in.income_source === "memory" ? "what you told Finlyt" : income ? undefined : "tell Finlyt in Ask"}
            info={explain("income")}
          />
          <Tile
            label={r.current ? "Spent, on pace" : "Spent"}
            value={formatPaise(r.current ? r.pace_paise : r.spent_paise)}
            info={explain("spentOnPace")}
          />
          {left !== null && left < 0 ? (
            <Tile label="Over" value={formatPaise(-left)} hint="more than your income" info={explain("left")} />
          ) : (
            <Tile
              label="Left"
              value={left === null ? "–" : formatPaise(left)}
              hint={saved === null ? undefined : `${Math.round(saved * 100)}% of income`}
              info={explain("left")}
            />
          )}
        </View>
        {r.current && r.one_off_paise > 0 ? (
          <Txt tone="muted" className="mt-2 text-xs">
            On pace counts rent, bills and big buys once.
          </Txt>
        ) : null}
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

      <Section title="Each day" info={explain("eachDay")}>
        <DailyBars days={r.by_day} limitPaise={limit} />
      </Section>

      {r.categories.length > 0 ? (
        <Section title="Where it went" info={explain("whereItWent")}>
          <RankedBars rows={categoryRows(r, allCategories ? undefined : 6, () => setAllCategories(true))} />
          <Txt tone="faint" className="mt-3 text-xs">
            Tap a category to see what&apos;s in it.
          </Txt>
        </Section>
      ) : null}

      {r.paid_from.length > 0 ? (
        <Section title="Paid from" info={explain("paidFrom")}>
          <RankedBars showUsual={false} rows={r.paid_from.map((a) => ({ key: String(a.account_id), label: a.name, paise: a.paid_paise }))} />
        </Section>
      ) : null}

      {r.biggest.length > 0 ? (
        <Section title="Biggest spends" info={explain("biggest")}>
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
        <Section title="Regular payments" info={explain("regular")}>
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

      {r.habits?.items.length ? (
        <Section title="Small habits" info={explain("habits")}>
          <Txt tone="muted" className="mb-1 text-sm">
            {formatPaise(r.habits.spent_paise)}
            {r.current ? " so far" : ""} · about {formatPaise(r.habits.year_paise)} a year at this rate
          </Txt>
          {r.habits.items.map((h) => (
            <Pressable
              key={h.key}
              onPress={() => router.push("/habits")}
              accessibilityRole="button"
              className="flex-row items-center gap-3 py-2 active:opacity-70"
            >
              <Icon icon={habitIcon(h)} size={18} tone="muted" />
              <View className="flex-1">
                <Txt weight="medium" numberOfLines={1}>
                  {h.label}
                </Txt>
                <Txt tone="muted" className="text-xs">
                  {h.kind === "delivery" ? `${h.times} ${h.times === 1 ? "order" : "orders"}` : `${h.days} ${h.days === 1 ? "day" : "days"}`}
                  {" · "}
                  {againstLastMonth(r, h.spent_paise, h.previous_paise)}
                </Txt>
              </View>
              <Txt weight="semibold">{formatPaise(h.spent_paise)}</Txt>
            </Pressable>
          ))}
          {r.habits.more ? (
            <Txt tone="muted" className="pt-1 text-xs">
              and {r.habits.more} more on the Small habits screen
            </Txt>
          ) : null}
        </Section>
      ) : null}

      {r.owed.to_me_paise || r.owed.i_owe_paise ? (
        <Section title="Owed" info={explain("owed")}>
          <Pressable onPress={() => router.push("/owed")} className="flex-row gap-2 active:opacity-70">
            <Tile label="Owed to you" value={formatPaise(r.owed.to_me_paise)} />
            <Tile label="You owe" value={formatPaise(r.owed.i_owe_paise)} />
          </Pressable>
        </Section>
      ) : null}

      {r.notes.length > 0 ? (
        <Section title="Worth a look" info={explain("notes")}>
          {r.notes.map((n, i) => (
            <View key={i} className="mb-2.5 flex-row gap-2.5">
              <Icon icon={Lightbulb} size={16} tone="muted" />
              <Txt className="flex-1 text-sm leading-5">{n}</Txt>
            </View>
          ))}
        </Section>
      ) : null}

      <InfoSheet visible={helpOpen} topic={reportHelp(r, topic)} onClose={() => setHelpOpen(false)} />
    </View>
  );
}
