import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { router, type Href } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect } from "react";
import { Platform } from "react-native";

export const REMINDER_CHANNEL = "reminders";
const TIMES_KEY = "finlyt.reminderTimes";

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
  if (hour < 15) return { title: "Lunch check 🍛", body: "Tag this morning's payments in Finlyt." };
  if (hour < 21) return { title: "Evening check", body: "Anything since lunch? Log it while you remember." };
  return { title: "Close the day 🌙", body: "Log the rest of today, cash included." };
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
      content: { ...messageFor(time.hour), data: { url: "/log" } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: time.hour,
        minute: time.minute,
        channelId: REMINDER_CHANNEL,
      },
    });
  }
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
    content: { title: "Finlyt test 🔔", body: "Reminders are working.", data: { url: "/log" } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 5,
      channelId: REMINDER_CHANNEL,
    },
  });
}

/** Tapping a reminder opens the screen in its `data.url` (the Log tab). */
export function useNotificationRedirect(enabled: boolean) {
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!enabled || !response) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const url = response.notification.request.content.data?.url;
    if (typeof url === "string") {
      router.push(url as Href);
      void Notifications.clearLastNotificationResponseAsync();
    }
  }, [enabled, response]);
}
