import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { router, type Href } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect } from "react";
import { Platform } from "react-native";

import { api } from "./api";

export const REMINDER_CHANNEL = "reminders";
const TIMES_KEY = "finlyt.reminderTimes";
const CHECK_IN_KEY = "finlyt.sundayCheckIn"; // the name is from when it was always Sunday

export type ReminderTime = { hour: number; minute: number };

export const DEFAULT_REMINDERS: ReminderTime[] = [
  { hour: 12, minute: 0 },
  { hour: 18, minute: 0 },
  { hour: 23, minute: 0 },
];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function messageFor(hour: number): { title: string; body: string } {
  if (hour < 15) return { title: "Midday check-in", body: "What did you spend on this morning?" };
  if (hour < 21) return { title: "Evening check-in", body: "Anything since lunch? Log it while you remember." };
  return { title: "Night check-in", body: "Close the day: log what's left, cash included." };
}

/** "6 PM check-in" for the latest reminder that has passed today, else null. */
export function currentCheckIn(times: ReminderTime[], now = new Date()): string | null {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const passed = times
    .filter((t) => t.hour * 60 + t.minute <= minutes)
    .sort((a, b) => b.hour * 60 + b.minute - (a.hour * 60 + a.minute))[0];
  if (!passed) return null;
  const h = passed.hour % 12 === 0 ? 12 : passed.hour % 12;
  const m = passed.minute ? `:${String(passed.minute).padStart(2, "0")}` : "";
  return `${h}${m} ${passed.hour < 12 ? "AM" : "PM"} check-in`;
}

export function formatTime({ hour, minute }: ReminderTime): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "18:30" → { hour: 18, minute: 30 }; null if it isn't a valid 24-hour time. */
export function parseTime(text: string): ReminderTime | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

/** The weekly planning check-in: a day (Monday 0 to Sunday 6, as on the server) and a time. */
export type CheckIn = ReminderTime & { weekday: number };

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const DEFAULT_CHECK_IN: CheckIn = { weekday: 6, hour: 19, minute: 0 };

/** "Sunday at 7:00 PM". */
export function describeCheckIn(c: CheckIn): string {
  return `${WEEKDAYS[c.weekday]} at ${formatTime(c)}`;
}

/** Today's weekday in the server's numbering (Monday 0). */
export function todayWeekday(now = new Date()): number {
  return (now.getDay() + 6) % 7;
}

async function savedCheckIn(): Promise<CheckIn | null> {
  const saved = await SecureStore.getItemAsync(CHECK_IN_KEY);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as Partial<CheckIn>;
    if (typeof parsed.hour !== "number" || typeof parsed.minute !== "number") return null;
    // Saved before the day could be chosen: it was Sunday.
    const weekday = typeof parsed.weekday === "number" && parsed.weekday >= 0 && parsed.weekday <= 6 ? parsed.weekday : 6;
    return { weekday, hour: parsed.hour, minute: parsed.minute };
  } catch {
    return null;
  }
}

export async function getCheckIn(): Promise<CheckIn> {
  return (await savedCheckIn()) ?? DEFAULT_CHECK_IN;
}

/** Tell the server the check-in day (it starts the weeks for bigger days and says when one is due). */
async function sendCheckInDay(weekday: number): Promise<boolean> {
  try {
    await api("/api/plan/check-in", { method: "PUT", body: { weekday } });
    return true;
  } catch (e) {
    console.warn("[check-in] couldn't send the day", e);
    return false;
  }
}

/** Save the check-in on the phone, move its reminder, and tell the server the day. */
export async function saveCheckIn(c: CheckIn): Promise<boolean> {
  await SecureStore.setItemAsync(CHECK_IN_KEY, JSON.stringify(c));
  await scheduleReminders();
  return sendCheckInDay(c.weekday);
}

/** On launch: make sure the server has the day chosen on this phone (if one was ever chosen). */
export async function syncCheckInDay(): Promise<void> {
  const saved = await savedCheckIn();
  if (saved) await sendCheckInDay(saved.weekday);
}

export async function getReminderTimes(): Promise<ReminderTime[]> {
  const saved = await SecureStore.getItemAsync(TIMES_KEY);
  if (!saved) return DEFAULT_REMINDERS;
  try {
    return JSON.parse(saved) as ReminderTime[];
  } catch {
    return DEFAULT_REMINDERS;
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "android") {
    // The channel has to exist before Android 13+ will show the permission prompt.
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
      name: "Reminders",
      description: "Reminders to log your spending",
      importance: AndroidImportance.HIGH,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Replace all scheduled reminders. Safe to call on every launch. Returns how many are set. */
export async function scheduleReminders(times?: ReminderTime[]): Promise<number> {
  const list = times ?? (await getReminderTimes());
  if (!(await ensureNotificationPermission())) return 0;
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const time of list) {
    await Notifications.scheduleNotificationAsync({
      content: { ...messageFor(time.hour), data: { url: "/" } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: time.hour,
        minute: time.minute,
        channelId: REMINDER_CHANNEL,
      },
    });
  }
  // The weekly check-in with Finlyt, on the day you chose: plan the coming week.
  const checkIn = await getCheckIn();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${WEEKDAYS[checkIn.weekday]} check-in`,
      body: "What's coming up this week? Five minutes with Finlyt to plan it.",
      data: { url: "/plan/chat" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: ((checkIn.weekday + 1) % 7) + 1, // Expo counts Sunday 1 to Saturday 7
      hour: checkIn.hour,
      minute: checkIn.minute,
      channelId: REMINDER_CHANNEL,
    },
  });
  return list.length;
}

export async function saveReminderTimes(times: ReminderTime[]): Promise<number> {
  const sorted = [...times].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  await SecureStore.setItemAsync(TIMES_KEY, JSON.stringify(sorted));
  return scheduleReminders(sorted);
}

export async function sendTestReminder(): Promise<void> {
  await ensureNotificationPermission();
  await Notifications.scheduleNotificationAsync({
    content: { title: "Finlyt", body: "Reminders are working.", data: { url: "/" } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 5,
      channelId: REMINDER_CHANNEL,
    },
  });
}

/** Tapping a reminder opens the screen in its `data.url` (Home, where logging happens). */
export function useNotificationRedirect(enabled: boolean) {
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!enabled || !response) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const url = response.notification.request.content.data?.url;
    if (typeof url === "string") {
      // Reminders scheduled before the redesign point at the old Log tab.
      router.navigate((url === "/log" ? "/" : url) as Href);
      void Notifications.clearLastNotificationResponseAsync();
    }
  }, [enabled, response]);
}
