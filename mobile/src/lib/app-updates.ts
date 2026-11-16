// Over-the-air updates (EAS Update, project in app.json). Screens, words and fixes in JavaScript
// reach the phone without a new APK; anything native still needs one (bump the app version then,
// since updates only go to builds with the same version: runtimeVersion policy "appVersion").
//
// When an update is found it downloads in the background, then Finlyt switches to it by itself,
// so nobody has to reopen the app to get it (the user asked for that on 2026-11-16):
// - right away, if the app opened or came back to the front less than 20 s ago;
// - otherwise the next time the app comes back to the front.
// Never while something is half done (words in the box, a receipt or an import being read, a
// check-in chat, the tour), because switching restarts the app's JavaScript; Home's
// "A new version is ready · Restart" banner covers those times.
//
// Waiting at launch for a new version (fallbackToCacheTimeout) would also do it, but that's a
// native setting and needs a new APK.
import * as Updates from "expo-updates";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { importDraft } from "./import-draft";
import { logDraft } from "./log-draft";
import { planChat } from "./plan-chat";
import { receiptDraft } from "./receipt-draft";
import { tour } from "./tour";

/** Fresh enough after opening (or coming back) that switching now won't interrupt anything. */
const FRESH_MS = 20_000;
/** Look again when coming back to the app, at most this often (the launch check covers opening). */
const RECHECK_MS = 2 * 60 * 1000;

let lastCheck = Date.now(); // the launch check has just run
let lastFront = Date.now(); // when the app last opened or came to the front

/** Something the person is in the middle of, which a restart would lose. */
function busy(): boolean {
  const log = logDraft.get();
  const receipt = receiptDraft.get();
  const plan = planChat.get();
  const imported = importDraft.get();
  return (
    log.text.trim().length > 0 ||
    log.note !== null ||
    log.pending !== null ||
    receipt.reading ||
    receipt.proposal !== null ||
    plan.pending ||
    (!plan.saved && plan.messages.some((m) => m.role === "user")) ||
    imported.reading ||
    imported.text.trim().length > 0 ||
    tour.get().active
  );
}

function apply(): void {
  void Updates.reloadAsync().catch((e) => console.warn("[updates] reload failed", e));
}

let switched = false;

/** Switch now if nothing's lost and the app has only just come to the front. */
function applyIfFresh(): boolean {
  // An emergency launch means an update failed to start and the app fell back to its own code:
  // switching by itself again could loop, so that's left to the banner.
  if (switched || Updates.isEmergencyLaunch || busy() || Date.now() - lastFront > FRESH_MS) return false;
  switched = true;
  apply();
  return true;
}

async function checkAndFetch(): Promise<boolean> {
  lastCheck = Date.now();
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return false;
    const fetched = await Updates.fetchUpdateAsync();
    return fetched.isNew;
  } catch (e) {
    // Offline, or Expo's servers are unreachable: try again next time.
    console.warn("[updates] check failed", e);
    return false;
  }
}

export function useAppUpdate(): { pending: boolean; restart: () => void } {
  const { isUpdatePending } = Updates.useUpdates();
  const pending = useRef(false);

  // Downloaded by the check at launch (or a later one): switch if the app has only just opened.
  useEffect(() => {
    pending.current = isUpdatePending;
    if (Updates.isEnabled && isUpdatePending) applyIfFresh();
  }, [isUpdatePending]);

  // Coming back to the app: switch to a waiting update, or look for a new one.
  useEffect(() => {
    if (!Updates.isEnabled) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      lastFront = Date.now();
      if (pending.current) {
        applyIfFresh();
        return;
      }
      if (Date.now() - lastCheck > RECHECK_MS) {
        void checkAndFetch().then((fetched) => {
          if (fetched) applyIfFresh();
        });
      }
    });
    return () => sub.remove();
  }, []);

  return { pending: Updates.isEnabled && isUpdatePending, restart: apply };
}

/** Which code is running, for the bottom of Settings: the APK's own, or an update (and when). */
export function runningLabel(): string {
  if (!Updates.isEnabled) return "";
  if (Updates.isEmbeddedLaunch || !Updates.updateId) return "As installed";
  const when = Updates.createdAt
    ? Updates.createdAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "";
  return `Update ${Updates.updateId.slice(0, 8)}${when ? ` · ${when}` : ""}`;
}
