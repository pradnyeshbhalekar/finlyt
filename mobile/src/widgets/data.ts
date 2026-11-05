// What the home-screen widgets show. Fetched straight from the API with the saved session, so a
// widget can refresh in the background without the app open, and cached so it can still draw its
// last numbers offline.
import * as SecureStore from "expo-secure-store";

import { API_URL } from "@/lib/config";
import { isoDate } from "@/lib/dates";
import { getReminderTimes, type ReminderTime } from "@/lib/notifications";
import type { ThemeMode } from "@/lib/theme";
import type { BankTxnItem, PlanStatus, Stats } from "@/lib/types";

const CACHE_KEY = "finlyt.widget";
const TOKEN_KEY = "finlyt.session"; // lib/auth keeps the session here
const PREFS_KEY = "finlyt.prefs"; // lib/prefs

export type WidgetData = {
  signedIn: boolean;
  /** Today's everyday spend in paise (what the daily limit counts). */
  todaySpent: number;
  dailyLimit: number | null;
  /** Bank payments waiting to be explained. */
  toLog: number;
  /** The last 7 days, oldest first, ending today. */
  week: { day: string; spend: number }[];
  reminders: ReminderTime[];
  theme: ThemeMode;
  updatedAt: string;
};

export const EMPTY: WidgetData = {
  signedIn: false,
  todaySpent: 0,
  dailyLimit: null,
  toLog: 0,
  week: [],
  reminders: [],
  theme: "auto",
  updatedAt: new Date(0).toISOString(),
};

async function get<T>(token: string, path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function theme(): Promise<ThemeMode> {
  try {
    const saved = await SecureStore.getItemAsync(PREFS_KEY);
    return (saved ? (JSON.parse(saved) as { theme?: ThemeMode }).theme : undefined) ?? "auto";
  } catch {
    return "auto";
  }
}

export async function loadWidgetData(): Promise<WidgetData> {
  try {
    const saved = await SecureStore.getItemAsync(CACHE_KEY);
    return saved ? { ...EMPTY, ...(JSON.parse(saved) as Partial<WidgetData>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Fresh numbers from the API, saved for next time. Falls back to the cache when offline. */
export async function fetchWidgetData(): Promise<WidgetData> {
  const [token, mode, reminders] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY),
    theme(),
    getReminderTimes().catch(() => []),
  ]);
  if (!token) return { ...EMPTY, theme: mode };

  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 6);
  try {
    const [stats, plan, txns] = await Promise.all([
      get<Stats>(token, `/api/stats?from=${isoDate(start)}&to=${isoDate(today)}`),
      get<PlanStatus>(token, "/api/plan"),
      get<{ items: BankTxnItem[] }>(token, "/api/txns"),
    ]);
    const byDay = new Map(stats.by_day.map((d) => [d.day, d.spend_paise]));
    const week = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const key = isoDate(day);
      return { day: key, spend: byDay.get(key) ?? 0 };
    });
    const data: WidgetData = {
      signedIn: true,
      todaySpent: plan.plan ? plan.today_spent_paise : (week[6]?.spend ?? 0),
      dailyLimit: plan.plan?.daily_limit_paise ?? null,
      toLog: txns.items.length,
      week,
      reminders,
      theme: mode,
      updatedAt: new Date().toISOString(),
    };
    await SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(data));
    return data;
  } catch (e) {
    console.warn("[widget] refresh failed", e);
    const cached = await loadWidgetData();
    return { ...cached, reminders, theme: mode };
  }
}

/** The next reminder after `now`: today's, or tomorrow's first. */
export function nextCheckIn(times: ReminderTime[], now = new Date()): { time: ReminderTime; tomorrow: boolean } | null {
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  const minutes = now.getHours() * 60 + now.getMinutes();
  const later = sorted.find((t) => t.hour * 60 + t.minute > minutes);
  return later ? { time: later, tomorrow: false } : { time: sorted[0], tomorrow: true };
}
