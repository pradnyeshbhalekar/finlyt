// Home before anything has ever been logged: the ways to log, in plain words, so a first
// look at the app says what to do. Goes away after the first entry.
import { ArrowDown, ChevronRight, Keyboard, Mic, Plus, ScanLine, type LucideIcon } from "lucide-react-native";
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

/** A way to log that starts when tapped. */
function TapWay({ label, onPress, ...way }: { label: string; onPress: () => void; icon: LucideIcon; title: string; text: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} className="active:opacity-60">
      <Way {...way} trailing={<Icon icon={ChevronRight} size={18} tone="muted" />} />
    </Pressable>
  );
}

export function FirstSteps({
  onType,
  onSay,
  onScan,
  onForm,
}: {
  onType: () => void;
  onSay: () => void;
  onScan: () => void;
  onForm: () => void;
}) {
  return (
    <Animated.View entering={FadeInDown.duration(400)} className="mt-6 rounded-3xl bg-surface p-5">
      <View className="flex-row items-center gap-3">
        <Coin size={44} variant="bare" />
        <View className="flex-1">
          <Txt weight="semibold" className="text-lg">
            Log your first expense
          </Txt>
          <Txt tone="muted" className="text-sm">
            Four ways. Tap whichever is easiest.
          </Txt>
        </View>
      </View>
      <TapWay label="Type it" onPress={onType} icon={Keyboard} title="Type it" text="The way you'd say it: “chai 40”." />
      <TapWay label="Say it" onPress={onSay} icon={Mic} title="Say it" text="Tap here or the mic, and talk." />
      <TapWay label="Scan a receipt" onPress={onScan} icon={ScanLine} title="Scan a receipt" text="Finlyt reads the shop and the total." />
      <TapWay label="Fill in a form" onPress={onForm} icon={Plus} title="Fill in a form" text="Amount, what for, how you paid." />
      <View className="mt-4 flex-row items-center gap-1.5">
        <Icon icon={ArrowDown} size={14} tone="muted" />
        <Txt tone="muted" className="text-xs">
          You can always use the box at the bottom of the screen
        </Txt>
      </View>
    </Animated.View>
  );
}
