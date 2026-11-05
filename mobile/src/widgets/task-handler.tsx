// Android calls this (in the background, app closed or not) when a widget is added, resized, or
// due its 30-minute refresh. Taps don't come here: they open finlyt:// links in the app.
import type { WidgetTaskHandlerProps } from "react-native-android-widget";

import { fetchWidgetData, loadWidgetData } from "./data";
import { renderFinlytWidget, WIDGETS, type WidgetName } from "./widgets";

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetInfo, widgetAction } = props;
  const name = widgetInfo.widgetName as WidgetName;
  if (!(name in WIDGETS)) return;
  if (widgetAction !== "WIDGET_ADDED" && widgetAction !== "WIDGET_UPDATE" && widgetAction !== "WIDGET_RESIZED") return;

  const size = { width: widgetInfo.width, height: widgetInfo.height };
  // A resize only needs a redraw; adding and the periodic update fetch fresh numbers.
  const data = widgetAction === "WIDGET_RESIZED" ? await loadWidgetData() : await fetchWidgetData();
  props.renderWidget(renderFinlytWidget(name, data, size));
}
