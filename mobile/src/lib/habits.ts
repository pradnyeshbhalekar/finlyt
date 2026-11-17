// Small habits: little spends that come back most days (ice cream, a cold drink, chai) and add up
// over a year. The server finds them and works out the numbers (backend services/habits.py); this
// picks the line to show after saving, and words the numbers for the screens.
import { formatPaise } from "./money";
import type { HabitAlertLevel } from "./prefs";
import type { Habit, HabitAlert, HabitRule } from "./types";

export const ALERT_LEVELS: { value: HabitAlertLevel; label: string; note: string }[] = [
  { value: "limit", label: "Past my limit", note: "Only when you go past a limit you set" },
  { value: "spotted", label: "Whenever one is spotted", note: "Also when Finlyt spots a new habit" },
  { value: "off", label: "Off", note: "Habits still show on the Plan tab" },
];

export function alertLevelLabel(level: HabitAlertLevel): string {
  return ALERT_LEVELS.find((l) => l.value === level)?.label ?? "";
}

const ORDER: Record<HabitAlert["kind"], number> = { over_limit: 0, big_order: 1, spotted: 2 };

/** The one habit line to show after saving, per the alert setting (or null). */
export function pickAlert(alerts: HabitAlert[] | undefined, level: HabitAlertLevel): string | null {
  if (!alerts?.length || level === "off") return null;
  const shown = alerts.filter((a) => a.kind !== "spotted" || level === "spotted");
  shown.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  return shown[0]?.text ?? null;
}

/** "18 days in 4 weeks", or "9 orders in 4 weeks" for food delivery. */
export function countNote(h: Habit): string {
  if (h.kind === "delivery") return `${h.times} ${h.times === 1 ? "order" : "orders"} in 4 weeks`;
  return `${h.days} ${h.days === 1 ? "day" : "days"} in 4 weeks`;
}

/** What you decided, in a few words. */
export function ruleNote(rule: HabitRule | null, h?: Habit): string {
  if (!rule) return h?.needs_answer ? "How do you use this?" : "No limit yet";
  if (rule.status === "keep") return "Fine as it is";
  if (rule.status === "need") return "A need, not a habit";
  if (rule.status === "later") return "Ask another time";
  if (rule.times_per_week === 0) return "Stopping";
  if (rule.times_per_week != null) return `At most ${rule.times_per_week} a week`;
  return `${formatPaise(rule.paise_per_week ?? 0)} a week`;
}

/** This week against the limit: "2 of 3 this week", "₹450 of ₹600 this week". */
export function weekNote(h: Habit): string | null {
  const rule = h.rule;
  if (!rule || rule.status !== "limit") return null;
  if (rule.times_per_week === 0) return h.this_week.times ? `${h.this_week.times} this week` : "None this week";
  if (rule.times_per_week != null) return `${h.this_week.times} of ${rule.times_per_week} this week`;
  return `${formatPaise(h.this_week.spent_paise)} of ${formatPaise(rule.paise_per_week ?? 0)} this week`;
}

/** What a year at `perWeek` times would save, against how often it is now. */
export function yearlySaving(h: Habit, perWeek: number): number {
  const atLimit = h.typical_paise * perWeek * 52;
  return Math.max(Math.round((h.year_paise - atLimit) / 1000) * 1000, 0);
}

/** Limits worth offering: fewer times a week than now. */
export function limitChoices(h: Habit): { label: string; perWeek: number }[] {
  const all = [
    { label: "Stop it", perWeek: 0 },
    { label: "1 a week", perWeek: 1 },
    { label: "Weekends only", perWeek: 2 },
    { label: "3 a week", perWeek: 3 },
  ];
  return all.filter((c) => c.perWeek < h.per_week);
}
