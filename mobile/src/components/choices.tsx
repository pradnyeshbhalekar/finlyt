// Answers to tap when Finlyt asks you something: a few rounded pills, then "Type my own" to
// answer in your own words in the box below. Kept plain, so the question stays the focus.
import { Pencil } from "lucide-react-native";
import { Pressable } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Icon, Txt } from "./ui";

export function Choices({
  options,
  onPick,
  onOther,
  disabled = false,
  inset = true,
}: {
  options: string[];
  onPick: (answer: string) => void;
  /** Focus the text box so you can write your own answer. */
  onOther: () => void;
  disabled?: boolean;
  /** Line up under a message that has the coin beside it (the check-in). */
  inset?: boolean;
}) {
  if (options.length === 0) return null;
  return (
    <Animated.View entering={FadeInDown.duration(300)} className={`mb-4 gap-2 ${inset ? "ml-9" : ""}`}>
      {options.map((option, i) => (
        <Pressable
          key={`${i}-${option}`}
          onPress={() => onPick(option)}
          disabled={disabled}
          accessibilityRole="button"
          className="self-start rounded-full border border-line px-4 py-2.5 active:bg-surface"
        >
          <Txt className="text-base">{option}</Txt>
        </Pressable>
      ))}
      <Pressable
        onPress={onOther}
        disabled={disabled}
        accessibilityRole="button"
        hitSlop={6}
        className="flex-row items-center gap-1.5 self-start px-1 py-1.5"
      >
        <Icon icon={Pencil} size={14} tone="muted" />
        <Txt tone="muted" className="text-sm">
          Type my own
        </Txt>
      </Pressable>
    </Animated.View>
  );
}
