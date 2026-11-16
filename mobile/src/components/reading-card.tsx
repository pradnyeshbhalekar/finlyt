// "Reading that…" on Home while Finlyt reads a note: the thinking coin on a plain card (no
// gradient, kept minimal at the user's request). It slides in, and the answer card takes its place.
import { View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";

import { SLOW_NOTE } from "@/lib/reply-alert";

import { Coin } from "./brand";
import { Txt } from "./ui";

export function ReadingCard({ slow, label = "Reading that…" }: { slow: boolean; label?: string }) {
  return (
    <Animated.View entering={FadeInDown.duration(260)} exiting={FadeOut.duration(150)} className="mt-6 rounded-3xl bg-surface">
      <View className="flex-row items-center gap-3 p-4">
        <Coin size={36} mood="thinking" variant="bare" />
        <View className="flex-1">
          <Txt tone="muted">{label}</Txt>
          {slow ? (
            <Txt tone="faint" className="mt-0.5 text-sm">
              {SLOW_NOTE}
            </Txt>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}
