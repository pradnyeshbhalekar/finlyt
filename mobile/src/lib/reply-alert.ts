// When Finlyt takes a while to answer and you've moved on (another tab, another screen, or out
// of the app), a notification says the answer is ready; tapping it opens that screen. Used
// wherever the AI answers: logging on Home, Ask, the check-in chat and Import. Home and Ask use
// the hook; the check-in chat and Import keep their work outside the screen (lib/plan-chat,
// lib/import-draft), so they call `alertIfAway` themselves, even after the screen is closed.
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

const REPLY_CHANNEL = "replies";

/** How long a wait has to be before the screen says "you can carry on, I'll notify you". */
const SLOW_AFTER_MS = 6000;

function short(text: string, max = 160): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Shows the notification now. Never asks for permission here: without it, nothing is shown. */
async function notify(title: string, body: string, url: string): Promise<void> {
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(REPLY_CHANNEL, {
        name: "Answers",
        description: "When Finlyt finishes an answer you didn't wait for",
        importance: AndroidImportance.HIGH,
      });
    }
    await Notifications.scheduleNotificationAsync({
      content: { title, body: short(body), data: { url } },
      trigger: Platform.OS === "android" ? { channelId: REPLY_CHANNEL } : null,
    });
  } catch (e) {
    console.warn("[reply-alert] couldn't notify", e);
  }
}

/** Notifies unless that screen is being looked at right now, in the open app. */
export function alertIfAway(screenFocused: boolean, title: string, body: string, url: string): void {
  if (screenFocused && AppState.currentState === "active") return;
  void notify(title, body, url);
}

/**
 * Returns `alert(title, body)`: call it when an answer arrives. It notifies only if this screen
 * isn't the one being looked at (or the app is in the background), and opens `url` when tapped.
 * A screen that has been closed stays quiet, because its answer went with it.
 */
export function useReplyAlert(url: string): (title: string, body: string) => void {
  const navigation = useNavigation();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (title, body) => {
    if (!mounted.current) return;
    alertIfAway(navigation.isFocused(), title, body, url);
  };
}

/** True once `pending` has lasted long enough that it's worth saying "this is taking a while". */
export function useSlow(pending: boolean, afterMs = SLOW_AFTER_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setSlow(true), afterMs);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [pending, afterMs]);
  return slow;
}

export const SLOW_NOTE = "Taking longer than usual. You can carry on; Finlyt will notify you when it's ready.";
