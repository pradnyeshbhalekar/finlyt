// Settings → Home screen widgets: live previews with your numbers. Tap one and Android asks where
// to put it on the home screen.
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { requestPinWidget, WidgetPreview } from "react-native-android-widget";

import { useTheme } from "@/lib/theme";
import { fetchWidgetData, loadWidgetData, type WidgetData } from "@/widgets/data";
import { refreshWidgets } from "@/widgets/refresh";
import { previewFinlytWidget, type WidgetName } from "@/widgets/widgets";

import { Txt } from "./ui";

const GAP = 12;

export function WidgetGallery({ width }: { width: number }) {
  const { name: theme } = useTheme();
  const [data, setData] = useState<WidgetData | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadWidgetData().then((cached) => alive && cached.signedIn && setData(cached));
    void fetchWidgetData().then((fresh) => alive && setData(fresh));
    return () => {
      alive = false;
    };
  }, []);

  if (Platform.OS !== "android" || !data) return null;

  async function add(name: WidgetName) {
    const asked = await requestPinWidget({ widgetName: name }).catch(() => false);
    setNote(
      asked
        ? "Choose where it goes on your home screen."
        : "Your launcher can't add widgets from here. Long-press the home screen → Widgets → Finlyt.",
    );
    void refreshWidgets();
  }

  const half = (width - GAP) / 2;
  const preview = (name: WidgetName, w: number, h: number) => (
    <WidgetPreview
      width={w}
      height={h}
      renderWidget={() => previewFinlytWidget(name, data, theme, { width: w, height: h })}
      onClick={() => void add(name)}
    />
  );

  return (
    <View>
      <View className="flex-row" style={{ gap: GAP }}>
        {preview("Today", half, half)}
        {preview("CheckIn", half, half)}
      </View>
      <View style={{ marginTop: GAP }}>{preview("LogExpense", width, 72)}</View>
      <View style={{ marginTop: GAP }}>{preview("Week", width, Math.round(width * 0.62))}</View>
      <Txt tone="muted" className="mt-3 text-sm">
        {note ?? "Tap one to add it to your home screen."}
      </Txt>
    </View>
  );
}
