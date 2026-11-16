// What each number and section in the month report means, in plain words and with this month's
// own numbers, for the ⓘ buttons next to them (components/month-report.tsx).
import { formatPaise } from "./money";
import type { MonthReport } from "./types";

export type HelpTopic = { title: string; lines: string[] };

export type HelpKey =
  | "spent"
  | "perDay"
  | "pace"
  | "usual"
  | "income"
  | "spentOnPace"
  | "left"
  | "eachDay"
  | "whereItWent"
  | "paidFrom"
  | "biggest"
  | "regular"
  | "owed"
  | "notes";

const ONE_OFFS = "rent, bills, investments, education, travel, gifts, and anything ₹2,000 or more";

export function reportHelp(r: MonthReport, key: HelpKey): HelpTopic {
  const month = r.label.split(" ")[0];
  const days = r.current ? `the ${r.days_counted} days so far` : `all ${r.days_in_month} days`;
  const budget = r.budget.budget_paise;
  const limit = r.budget.plan?.daily_limit_paise ?? null;
  switch (key) {
    case "spent":
      return {
        title: r.current ? "Spent so far" : "Spent",
        lines: [
          `Everything you logged in ${month}, counting only your share. If lunch was ${formatPaise(45000)} and a friend owes you ${formatPaise(20000)}, ${formatPaise(25000)} counts.`,
          "Money you owe someone counts on the day you pay them back.",
          ...(budget
            ? [`The ring fills towards your ${formatPaise(budget)} budget for the month and turns red if you go over.`]
            : []),
          ...(r.last_month.total_paise
            ? [
                r.current
                  ? `The comparison is with the first ${r.days_counted} days of ${r.last_month.label} (${formatPaise(r.last_month.same_point_paise)}), so part of a month isn't compared with a whole one.`
                  : `The comparison is with all of ${r.last_month.label} (${formatPaise(r.last_month.total_paise)}).`,
              ]
            : []),
        ],
      };
    case "perDay":
      return {
        title: "A day",
        lines: [
          `Your average day: ${formatPaise(r.spent_paise)} over ${days} is about ${formatPaise(r.per_day_paise)} a day.`,
          "Big one-off payments like rent push it up, so it's often higher than a normal day feels.",
        ],
      };
    case "pace":
      return {
        title: "On pace for",
        lines: [
          `Where ${month} ends up if you keep spending the way you have: about ${formatPaise(r.pace_paise)}.`,
          `Everyday spending (${formatPaise(r.everyday_paise)} so far) is stretched over all ${r.days_in_month} days. One-offs (${formatPaise(r.one_off_paise)} so far: ${ONE_OFFS}) count once, because they won't happen again every day.`,
          "It gets more accurate as the month goes on.",
        ],
      };
    case "usual":
      return {
        title: "Usually",
        lines: [
          `What a month usually costs you: the average of your last ${r.usual.months === 1 ? "month" : `${r.usual.months} months`} with entries (up to 3), which is ${formatPaise(r.usual.total_paise)}.`,
          "Compare it with On pace for to see if this month is heading above or below normal.",
        ],
      };
    case "income":
      return {
        title: r.money_in.income_source === "bank" ? "Income" : "Monthly income",
        lines:
          r.money_in.income_source === "bank"
            ? [`Money that came into your bank in ${month} and was marked as income: ${formatPaise(r.money_in.income_paise)}.`]
            : r.money_in.income_source === "memory"
              ? [
                  `The monthly income you told Finlyt: ${formatPaise(r.money_in.salary_paise ?? 0)}.`,
                  "To change it, tell Finlyt in Ask, like “my salary is 50,000 now”.",
                ]
              : [
                  "Finlyt doesn't know your income yet, so it can't work out what's left.",
                  "Tell it in Ask, like “my salary is 50,000 a month”.",
                ],
      };
    case "spentOnPace":
      return {
        title: r.current ? "Spent, on pace" : "Spent",
        lines: r.current
          ? [
              `Not what you've spent so far, but where ${month} is heading (see On pace for): ${formatPaise(r.pace_paise)}.`,
              "That way, Left shows what you'd have at the end of the month, not just today.",
            ]
          : [`Everything you spent in ${month}: ${formatPaise(r.spent_paise)}.`],
      };
    case "left": {
      const left = r.money_in.left_paise;
      if (left !== null && left < 0) {
        return {
          title: "Over",
          lines: [
            `Your spending${r.current ? " on pace" : ""} is ${formatPaise(-left)} more than your income for the month.`,
            "Savings or a credit card would cover the gap. Ask Finlyt where to cut back.",
          ],
        };
      }
      return {
        title: "Left",
        lines: [
          `Income minus spending${r.current ? " on pace" : ""}: what you'd have at the end of ${month}${left !== null ? `, about ${formatPaise(left)}` : ""}.`,
          ...(r.money_in.saved_share !== null
            ? [`${Math.round(r.money_in.saved_share * 100)}% of your income. That share is your savings rate; many people aim for 20% or more.`]
            : []),
          ...(r.money_in.commitments_paise
            ? [`Commitments you told Finlyt about (EMIs, SIPs and the like) take ${formatPaise(r.money_in.commitments_paise)} a month of it.`]
            : []),
        ],
      };
    }
    case "eachDay":
      return {
        title: "Each day",
        lines: [
          "One bar for each day: how much you spent that day. Taller bars are bigger days.",
          ...(limit
            ? [`The line across is your usual-day limit from your plan, ${formatPaise(limit)}. Bars above it are days you went over (bigger days in your plan are allowed to).`]
            : ["Make a plan in the Plan tab and a line shows your daily limit."]),
        ],
      };
    case "whereItWent":
      return {
        title: "Where it went",
        lines: [
          "Your spending by category, biggest first. The % is that category's share of the month.",
          "The thin mark on a bar is what you usually spend there (the average of recent months). A bar past its mark is more than usual.",
          "Tap a category to see every entry in it.",
        ],
      };
    case "paidFrom":
      return {
        title: "Paid from",
        lines: [
          "Which of your accounts the money left from: your bank (UPI, card) or cash.",
          "Handy for checking it matches your bank statement.",
        ],
      };
    case "biggest":
      return {
        title: "Biggest spends",
        lines: ["Your largest single entries this month, by your share. Tap one to see or change it."],
      };
    case "regular":
      return {
        title: "Regular payments",
        lines: [
          "Things you pay for month after month: the same payment in at least 2 of the last 3 months, for about the same amount. Rent, subscriptions, recharges, a gym.",
          "The amount is what it usually costs. They're worth a look when you want to cut back.",
        ],
      };
    case "owed":
      return {
        title: "Owed",
        lines: [
          "Owed to you: what friends still owe you for things you paid for, all months together.",
          "You owe: what you still owe people who paid for you. Tap to see who.",
        ],
      };
    case "notes":
      return {
        title: "Worth a look",
        lines: [
          "Things Finlyt noticed in this month: a category well above your usual, the month heading over budget, payments you haven't logged, and the like.",
          "They're only pointers. Ask Finlyt about any of them for more.",
        ],
      };
  }
}
