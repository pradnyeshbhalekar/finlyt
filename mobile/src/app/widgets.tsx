// Home screen widgets, opened from Settings: live previews of each one. Tap one to add it.
import { ScrollView, useWindowDimensions } from "react-native";

import { Txt } from "@/components/ui";
import { WidgetGallery } from "@/components/widget-gallery";

export default function Widgets() {
  const { width } = useWindowDimensions();
  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pb-16 pt-2">
      <Txt tone="muted" className="mb-5 text-base leading-6">
        Keep Finlyt on your home screen: today against your limit, the next check-in, a quick log, your week.
      </Txt>
      <WidgetGallery width={width - 40} />
    </ScrollView>
  );
}
