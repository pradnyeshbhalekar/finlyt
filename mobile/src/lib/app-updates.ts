// Over-the-air updates (EAS Update, project in app.json). Screens, words and fixes in JavaScript
// reach the phone without a new APK; anything native still needs one (bump the app version then,
// since updates only go to builds with the same version: runtimeVersion policy "appVersion").
//
// The app checks when it opens (app.json updates.checkAutomatically) and again whenever it comes
// back to the front, at most every 30 minutes, and downloads what it finds in the background.
// A downloaded update is used the next time the app starts; `pending` lets Home offer a restart
// so it doesn't wait for Android to close the app.
import * as Updates from "expo-updates";
import { useEffect } from "react";
import { AppState } from "react-native";

const RECHECK_MS = 30 * 60 * 1000;
let lastCheck = Date.now(); // the launch check just ran

async function checkAndFetch(): Promise<void> {
  lastCheck = Date.now();
  try {
    const check = await Updates.checkForUpdateAsync();
    if (check.isAvailable) await Updates.fetchUpdateAsync();
  } catch (e) {
    // Offline, or Expo's servers are unreachable: try again next time.
    console.warn("[updates] check failed", e);
  }
}

export function useAppUpdate(): { pending: boolean; restart: () => void } {
  const { isUpdatePending } = Updates.useUpdates();

  useEffect(() => {
    if (!Updates.isEnabled) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && Date.now() - lastCheck > RECHECK_MS) void checkAndFetch();
    });
    return () => sub.remove();
  }, []);

  return {
    pending: Updates.isEnabled && isUpdatePending,
    restart: () => void Updates.reloadAsync().catch((e) => console.warn("[updates] reload failed", e)),
  };
}
