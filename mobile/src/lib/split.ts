// Splitting one bill with friends: who owes what for each way of sharing it. Dues are whole
// rupees (nobody pays back ₹617.50); your share takes whatever's left, so it always adds up.
import { formatPaise } from "./money";

export type SplitMode = "equal" | "me25" | "me75" | "theyAll" | "custom";

export const SPLITS: { mode: SplitMode; label: string }[] = [
  { mode: "equal", label: "Equal" },
  { mode: "me25", label: "I pay 25%" },
  { mode: "me75", label: "I pay 75%" },
  { mode: "theyAll", label: "They pay all" },
  { mode: "custom", label: "Custom" },
];

/** Your part of the bill for each way of sharing, as a fraction (custom has none). */
const MINE: Record<Exclude<SplitMode, "custom">, (people: number) => number> = {
  equal: (people) => 1 / (people + 1),
  me25: () => 0.25,
  me75: () => 0.75,
  theyAll: () => 0,
};

const wholeRupees = (paise: number) => Math.round(paise / 100) * 100;

/**
 * What each of `people` owes you, in paise. `custom` holds the amounts typed for custom
 * (null where nothing valid is typed yet).
 */
export function splitDues(totalPaise: number, mode: SplitMode, people: number, custom: (number | null)[] = []): (number | null)[] {
  if (people <= 0) return [];
  if (mode === "custom") return Array.from({ length: people }, (_, i) => custom[i] ?? null);
  const theirs = totalPaise * (1 - MINE[mode](people));
  const each = wholeRupees(theirs / people);
  const dues = Array.from({ length: people }, () => each);
  if (mode === "theyAll") {
    // All of it, exactly: the last person takes the odd rupees.
    dues[people - 1] = totalPaise - each * (people - 1);
  }
  return dues;
}

/** "You pay ₹310 (25%), Rahul owes you ₹930" or what's missing. */
export function describeSplit(totalPaise: number, names: string[], dues: (number | null)[]): string {
  if (names.length === 0) return "";
  if (dues.some((d) => d === null || d <= 0)) return "Type how much each person owes you.";
  const owed = dues.reduce<number>((sum, d) => sum + (d ?? 0), 0);
  if (owed > totalPaise) return `That's ${formatPaise(owed - totalPaise)} more than the bill.`;
  const mine = totalPaise - owed;
  const pct = totalPaise ? Math.round((mine / totalPaise) * 100) : 0;
  const them = names.map((n, i) => `${n || "they"} ${names.length > 1 ? "owes" : "owes you"} ${formatPaise(dues[i] ?? 0)}`).join(", ");
  return `You pay ${formatPaise(mine)} (${pct}%), ${them}.`;
}

/** The dues to save, or an error to show. */
export function checkSplit(
  totalPaise: number,
  names: string[],
  dues: (number | null)[],
): { dues: { person_name: string; amount_paise: number }[] } | { error: string } {
  const out: { person_name: string; amount_paise: number }[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i].trim();
    const paise = dues[i];
    if (!name) return { error: "Add a name for each person who owes you." };
    if (!paise || paise <= 0) return { error: `How much does ${name} owe you?` };
    out.push({ person_name: name, amount_paise: paise });
  }
  const owed = out.reduce((sum, d) => sum + d.amount_paise, 0);
  if (owed > totalPaise) return { error: "People can't owe you more than the bill." };
  const seen = new Set<string>();
  for (const d of out) {
    const key = d.person_name.toLowerCase();
    if (seen.has(key)) return { error: `${d.person_name} is in the list twice.` };
    seen.add(key);
  }
  return { dues: out };
}
