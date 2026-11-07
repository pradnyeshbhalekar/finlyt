import { formatPaise } from "./money";
import type { Goal } from "./types";

/** "₹4,500 a month to reach it by Dec 2026", "₹9,000 to go" or "Reached". */
export function goalNote(g: Goal): string {
  if (g.done) return "Reached";
  const due = g.due_on ? new Date(`${g.due_on}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : null;
  if (due && g.monthly_needed_paise) return `${formatPaise(g.monthly_needed_paise)} a month to reach it by ${due}`;
  return `${formatPaise(g.left_paise)} to go`;
}
