// Numbers you change with − and + (or type): rupee amounts and counts. Used by the check-in's plan
// card and the small-habit sheet.
import { Minus, Plus } from "lucide-react-native";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { fonts } from "@/lib/theme";

import { Icon, Txt, type IconType } from "./ui";

function RoundButton({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: IconType;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      className={`h-9 w-9 items-center justify-center rounded-full bg-surface active:opacity-70 ${disabled ? "opacity-40" : ""}`}
    >
      <Icon icon={icon} size={18} />
    </Pressable>
  );
}

/** A rupee amount with − and +, which you can also tap and type. Rounded to ₹10. */
export function AmountStepper({
  label,
  hint,
  paise,
  min,
  step,
  onChange,
}: {
  label: string;
  hint?: string;
  paise: number;
  min: number;
  step: number;
  onChange: (paise: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft === null) return;
    const rupees = parseInt(draft.replace(/\D/g, ""), 10);
    setDraft(null);
    if (!Number.isNaN(rupees)) onChange(Math.max(min, Math.round(rupees / 10) * 1000));
  }
  return (
    <View className="flex-row items-center gap-2 py-2">
      <View className="flex-1">
        <Txt weight="medium">{label}</Txt>
        {hint ? (
          <Txt tone="muted" className="text-xs">
            {hint}
          </Txt>
        ) : null}
      </View>
      <RoundButton icon={Minus} label={`Less for ${label}`} onPress={() => onChange(Math.max(min, paise - step))} disabled={paise - step < min} />
      <View className="w-24 flex-row items-center justify-center">
        <Txt weight="semibold" className="text-lg">
          ₹
        </Txt>
        <TextInput
          value={draft ?? String(Math.round(paise / 100))}
          onChangeText={setDraft}
          onEndEditing={commit}
          onBlur={commit}
          keyboardType="number-pad"
          selectTextOnFocus
          accessibilityLabel={label}
          className="min-w-10 py-0 text-center text-lg text-fg"
          style={{ fontFamily: fonts.semibold }}
        />
      </View>
      <RoundButton icon={Plus} label={`More for ${label}`} onPress={() => onChange(paise + step)} />
    </View>
  );
}

/** A whole number with − and +, e.g. bigger days a week, or times a week for a habit. */
export function CountStepper({
  label,
  hint,
  value,
  min = 0,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <View className="flex-row items-center gap-2 py-2">
      <View className="flex-1">
        <Txt weight="medium">{label}</Txt>
        {hint ? (
          <Txt tone="muted" className="text-xs">
            {hint}
          </Txt>
        ) : null}
      </View>
      <RoundButton icon={Minus} label={`Fewer for ${label}`} onPress={() => onChange(Math.max(min, value - 1))} disabled={value <= min} />
      <View className="w-24 items-center">
        <Txt weight="semibold" className="text-lg">
          {value}
        </Txt>
      </View>
      <RoundButton icon={Plus} label={`More for ${label}`} onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} />
    </View>
  );
}
