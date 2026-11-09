const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date as YYYY-MM-DD (the phone is on IST). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfWeek(d: Date): Date {
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return monday;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function dayLabel(day: string): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (day === isoDate(today)) return "Today";
  if (day === isoDate(yesterday)) return "Yesterday";
  const [y, m, dd] = day.split("-").map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

/** "Yesterday, 8:00 pm", or just "8:00 pm" for today. */
export function whenLabel(iso: string): string {
  const day = isoDate(new Date(iso));
  return day === isoDate(new Date()) ? timeLabel(iso) : `${dayLabel(day)}, ${timeLabel(iso)}`;
}

/** The same time of day on another day (YYYY-MM-DD), but never later than now. */
export function moveToDay(iso: string, day: string): string {
  const from = new Date(iso);
  const [y, m, d] = day.split("-").map(Number);
  const moved = new Date(y, m - 1, d, from.getHours(), from.getMinutes(), from.getSeconds());
  const now = new Date();
  return (moved > now ? now : moved).toISOString();
}

/** A day heading with its date always shown: "Today · 7 Nov", "Yesterday · 6 Nov", "Thu, 5 Nov". */
export function dayHeading(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const short = date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const label = dayLabel(day);
  return label === "Today" || label === "Yesterday" ? `${label} · ${short}` : label;
}

/** When something happened, with the date always shown: "Today 8 Nov, 10:13 pm", "Thu 5 Nov, 9:40 pm". */
export function dateTimeLabel(iso: string): string {
  const d = new Date(iso);
  const label = dayLabel(isoDate(d));
  const day =
    label === "Today" || label === "Yesterday"
      ? `${label} ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
      : label.replace(",", "");
  return `${day}, ${timeLabel(iso)}`;
}
