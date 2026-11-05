const whole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const exact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 45000 → "₹450", 45050 → "₹450.50" */
export function formatPaise(paise: number): string {
  return (paise % 100 === 0 ? whole : exact).format(paise / 100);
}

/** "₹1,250.5" → 125050; null if it isn't a positive amount with at most 2 decimals. */
export function parseRupees(input: string): number | null {
  const clean = input.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [rupees, paise = ""] = clean.split(".");
  const total = Number(rupees) * 100 + Number(paise.padEnd(2, "0"));
  return total > 0 ? total : null;
}
