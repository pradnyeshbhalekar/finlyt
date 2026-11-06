// Answers to tap when Finlyt asks you something, the way Claude asks: a short numbered list of
// likely answers, and "Something else" to type your own in the box below.
import { ChevronRight, Pencil } from "lucide-react-native";
import { Pressable, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Icon, Txt } from "./ui";

export function Choices({
  options,
  onPick,
  onOther,
  disabled = false,
}: {
  options: string[];
  onPick: (answer: string) => void;
  /** Focus the text box so you can write your own answer. */
  onOther: () => void;
  disabled?: boolean;
}) {
  if (options.length === 0) return null;
  return (
    <Animated.View entering={FadeInDown.duration(300)} className="mb-3 ml-9 overflow-hidden rounded-3xl border border-line">
      {options.map((option, i) => (
        <Pressable
          key={`${i}-${option}`}
          onPress={() => onPick(option)}
          disabled={disabled}
          accessibilityRole="button"
          className={`min-h-12 flex-row items-center gap-3 px-4 py-3 active:bg-surface ${i > 0 ? "border-t border-line" : ""}`}
        >
          <View className="h-6 w-6 items-center justify-center rounded-full bg-surface">
            <Txt weight="semibold" tone="muted" className="text-xs">
              {i + 1}
            </Txt>
          </View>
          <Txt className="flex-1 text-base">{option}</Txt>
          <Icon icon={ChevronRight} size={16} tone="faint" />
        </Pressable>
      ))}
      <Pressable
        onPress={onOther}
        disabled={disabled}
        accessibilityRole="button"
        className="min-h-12 flex-row items-center gap-3 border-t border-line px-4 py-3 active:bg-surface"
      >
        <View className="h-6 w-6 items-center justify-center">
          <Icon icon={Pencil} size={16} tone="muted" />
        </View>
        <Txt tone="muted" className="flex-1 text-base">
          Something else…
        </Txt>
      </Pressable>
    </Animated.View>
  );
}
