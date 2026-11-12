// Home before anything has ever been logged: the three ways to log, in plain words, so a first
// look at the app says what to do. Goes away after the first entry.
import { ArrowDown, ChevronRight, Keyboard, Mic, Plus, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Coin } from "./brand";
import { Icon, Txt } from "./ui";

function Way({ icon, title, text, trailing }: { icon: LucideIcon; title: string; text: string; trailing?: ReactNode }) {
  return (
    <View className="mt-3 flex-row items-center gap-3">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-bg">
        <Icon icon={icon} size={19} tone="accent" />
      </View>
      <View className="flex-1">
        <Txt weight="semibold" className="text-base">
          {title}
        </Txt>
        <Txt tone="muted" className="text-sm" style={{ lineHeight: 19 }}>
          {text}
        </Txt>
      </View>
      {trailing}
    </View>
  );
}

export function FirstSteps({ onForm }: { onForm: () => void }) {
  return (
    <Animated.View entering={FadeInDown.duration(400)} className="mt-6 rounded-3xl bg-surface p-5">
      <View className="flex-row items-center gap-3">
        <Coin size={44} variant="bare" />
        <View className="flex-1">
          <Txt weight="semibold" className="text-lg">
            Log your first expense
          </Txt>
          <Txt tone="muted" className="text-sm">
            Three ways. Pick whichever is easiest.
          </Txt>
        </View>
      </View>
      <Way icon={Keyboard} title="Type it" text="In the box at the bottom, the way you'd say it: “chai 40”." />
      <Way icon={Mic} title="Say it" text="Tap the mic in the box and talk." />
      <Pressable onPress={onForm} accessibilityRole="button" accessibilityLabel="Fill in a form" className="active:opacity-60">
        <Way
          icon={Plus}
          title="Fill in a form"
          text="Tap + in the box, or here."
          trailing={<Icon icon={ChevronRight} size={18} tone="muted" />}
        />
      </Pressable>
      <View className="mt-4 flex-row items-center gap-1.5">
        <Icon icon={ArrowDown} size={14} tone="muted" />
        <Txt tone="muted" className="text-xs">
          The box is at the bottom of the screen
        </Txt>
      </View>
    </Animated.View>
  );
}
