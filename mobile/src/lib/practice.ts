// The practice box in onboarding: reads a note like "chai 40 cash" on the phone, well enough to
// show what Finlyt does with it. Nothing goes to the server and nothing is saved; real notes are
// read by the backend (quick parse, then the AI).

export type PracticeEntry = {
  description: string;
  /** Whole rupees. */
  amount: number;
  category: string;
  paidWith: string;
  /** "Rahul owes ₹200", when the note says someone owes part of it. */
  owes: { name: string; amount: number } | null;
};

const CATEGORIES: [RegExp, string][] = [
  [/chai|tea|coffee|lunch|dinner|breakfast|snack|food|pizza|biryani|zomato|swiggy|khana/i, "Food"],
  [/auto|cab|uber|ola|rapido|bus|train|metro|petrol|fuel|taxi/i, "Transport"],
  [/grocer|milk|vegetable|sabzi|dmart|blinkit|zepto/i, "Groceries"],
  [/movie|netflix|game/i, "Entertainment"],
  [/rent/i, "Rent"],
  [/bill|recharge|electricity|wifi/i, "Bills"],
  [/shirt|shoes|clothes|amazon|flipkart/i, "Shopping"],
  [/medicine|doctor|pharmacy/i, "Health"],
];

function rupees(digits: string, k: string | undefined): number {
  return Math.round(Number(digits.replace(/,/g, "")) * (k ? 1000 : 1));
}

/** Null when there's no amount in the note. */
export function practiceParse(text: string): PracticeEntry | null {
  const note = text.trim();
  const first = /(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/i.exec(note);
  if (!first) return null;
  const amount = rupees(first[1], first[2]);
  if (!amount) return null;

  const owed = /owes?\s+(?:me\s+)?(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/i.exec(note);
  const friend = /\bwith\s+([A-Za-z]+)/i.exec(note);
  const owes =
    owed && rupees(owed[1], owed[2]) < amount
      ? { name: friend ? friend[1][0].toUpperCase() + friend[1].slice(1) : "Your friend", amount: rupees(owed[1], owed[2]) }
      : null;

  const what = note.slice(0, first.index).replace(/[\s,:-]+$/, "").trim();
  const description = what ? what[0].toUpperCase() + what.slice(1) : "Expense";

  return {
    description: friend && owes ? `${description} with ${owes.name}` : description,
    amount,
    category: CATEGORIES.find(([words]) => words.test(note))?.[1] ?? "Other",
    paidWith: /\bcash\b|nakad/i.test(note) ? "Cash" : "Bank", // a new user's accounts are Bank and Cash
    owes,
  };
}
