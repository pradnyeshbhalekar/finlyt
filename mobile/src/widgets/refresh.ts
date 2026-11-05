// Keep widgets on the home screen in step with the app: after something is saved, and when the
// app goes to the background. Does nothing if no Finlyt widget has been added.
import { Platform } from "react-native";
import { getWidgetInfo, requestWidgetUpdate } from "react-native-android-widget";

import { fetchWidgetData } from "./data";
import { renderFinlytWidget, WIDGET_NAMES } from "./widgets";

let timer: ReturnType<typeof setTimeout> | null = null;

export async function refreshWidgets(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const placed = await Promise.all(WIDGET_NAMES.map(async (name) => [name, (await getWidgetInfo(name)).length] as const));
    const names = placed.filter(([, count]) => count > 0).map(([name]) => name);
    if (names.length === 0) return;
    const data = await fetchWidgetData();
    await Promise.all(
      names.map((name) =>
        requestWidgetUpdate({
          widgetName: name,
          renderWidget: (info) => renderFinlytWidget(name, data, { width: info.width, height: info.height }),
        }),
      ),
    );
  } catch (e) {
    console.warn("[widget] update failed", e);
  }
}

/** Coalesces bursts (a save refetches several queries) into one refresh. */
export function scheduleWidgetRefresh(delayMs = 1500): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void refreshWidgets();
  }, delayMs);
}
