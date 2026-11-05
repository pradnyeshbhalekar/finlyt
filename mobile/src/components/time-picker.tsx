// A small, all-JS time picker in a bottom sheet: hour, minutes in 5s, AM/PM.
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import type { ReminderTime } from "@/lib/notifications";

import { Button, Segmented, Sheet, Txt } from "./ui";

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export function formatClock({ hour, minute }: ReminderTime): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function Cell({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`m-1 h-11 w-14 items-center justify-center rounded-full ${selected ? "bg-brand" : "bg-surface"}`}
    >
      <Txt weight={selected ? "semibold" : "medium"} tone={selected ? "onBrand" : "fg"}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function TimePickerSheet({
  visible,
  initial,
  onClose,
  onDone,
}: {
  visible: boolean;
  initial: ReminderTime;
  onClose: () => void;
  onDone: (time: ReminderTime) => void;
}) {
  // The parent remounts this with a new `key` per edit, so `initial` seeds the state once.
  const [hour12, setHour12] = useState(initial.hour % 12 === 0 ? 12 : initial.hour % 12);
  const [minute, setMinute] = useState(initial.minute - (initial.minute % 5));
  const [half, setHalf] = useState<"AM" | "PM">(initial.hour < 12 ? "AM" : "PM");
  const hour = (hour12 % 12) + (half === "PM" ? 12 : 0);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Txt weight="bold" className="mb-4 text-center text-4xl">
        {formatClock({ hour, minute })}
      </Txt>
      <ScrollView bounces={false}>
        <View className="flex-row flex-wrap justify-center">
          {HOURS.map((h) => (
            <Cell key={h} label={String(h)} selected={h === hour12} onPress={() => setHour12(h)} />
          ))}
        </View>
        <View className="mt-3 flex-row flex-wrap justify-center">
          {MINUTES.map((m) => (
            <Cell
              key={m}
              label={`:${String(m).padStart(2, "0")}`}
              selected={m === minute}
              onPress={() => setMinute(m)}
            />
          ))}
        </View>
        <View className="mt-4">
          <Segmented
            options={[
              { value: "AM", label: "AM" },
              { value: "PM", label: "PM" },
            ]}
            value={half}
            onChange={setHalf}
          />
        </View>
      </ScrollView>
      <View className="mt-5 flex-row gap-3">
        <Button label="Cancel" variant="secondary" onPress={onClose} className="flex-1" />
        <Button label="Done" onPress={() => onDone({ hour, minute })} className="flex-1" />
      </View>
    </Sheet>
  );
}
