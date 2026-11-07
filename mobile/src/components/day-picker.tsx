// Which day something happened: Today, Yesterday, or an earlier day this week. Used on the card
// you check before saving, and on an entry's screen to fix a date afterwards.
import { useState } from "react";
import { Pressable, View } from "react-native";

import { dayLabel, isoDate } from "@/lib/dates";

import { Sheet, Txt } from "./ui";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={`rounded-full px-3.5 py-1.5 ${selected ? "bg-brand" : "border border-line active:bg-surface"}`}
    >
      <Txt weight="medium" tone={selected ? "onBrand" : "fg"} className="text-sm">
        {label}
      </Txt>
    </Pressable>
  );
}

export function DayChips({ value, onPick }: { value: string; onPick: (day: string) => void }) {
  const [earlier, setEarlier] = useState(false);
  const today = daysAgo(0);
  const yesterday = daysAgo(1);
  const other = value !== today && value !== yesterday;
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      <Chip label="Today" selected={value === today} onPress={() => onPick(today)} />
      <Chip label="Yesterday" selected={value === yesterday} onPress={() => onPick(yesterday)} />
      <Chip label={other ? dayLabel(value) : "Earlier…"} selected={other} onPress={() => setEarlier(true)} />
      <Sheet visible={earlier} onClose={() => setEarlier(false)}>
        <Txt weight="semibold" className="mb-3 text-lg">
          Which day?
        </Txt>
        <View className="flex-row flex-wrap gap-2">
          {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) => {
            const day = daysAgo(n);
            return (
              <Chip
                key={day}
                label={dayLabel(day)}
                selected={value === day}
                onPress={() => {
                  setEarlier(false);
                  onPick(day);
                }}
              />
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}
