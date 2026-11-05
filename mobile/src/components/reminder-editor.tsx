// Edit the daily check-in times: tap a time to change it, X to remove, or add another.
import { Clock, Plus, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import type { ReminderTime } from "@/lib/notifications";

import { formatClock, TimePickerSheet } from "./time-picker";
import { Icon, Row, Txt } from "./ui";

function label({ hour }: ReminderTime): string {
  if (hour < 11) return "Morning";
  if (hour < 15) return "Midday";
  if (hour < 21) return "Evening";
  return "Night";
}

const minutes = (t: ReminderTime) => t.hour * 60 + t.minute;

export function ReminderEditor({
  times,
  onChange,
}: {
  times: ReminderTime[];
  onChange: (times: ReminderTime[]) => void;
}) {
  // Which time is being edited: an index, "new", or nothing.
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [round, setRound] = useState(0);

  function open(target: number | "new") {
    setRound((r) => r + 1); // fresh picker state each time
    setEditing(target);
  }

  function done(time: ReminderTime) {
    const next = editing === "new" ? [...times, time] : times.map((t, i) => (i === editing ? time : t));
    const unique = next.filter((t, i) => next.findIndex((u) => minutes(u) === minutes(t)) === i);
    onChange(unique.sort((a, b) => minutes(a) - minutes(b)));
    setEditing(null);
  }

  const initial =
    editing === "new" || editing === null ? { hour: 21, minute: 0 } : (times[editing] ?? { hour: 21, minute: 0 });

  return (
    <View className="-mx-3">
      {times.map((t, i) => (
        <Row
          key={`${t.hour}:${t.minute}`}
          onPress={() => open(i)}
          leading={<Icon icon={Clock} size={20} tone="muted" />}
          title={<Txt weight="medium" className="text-base">{formatClock(t)}</Txt>}
          subtitle={label(t)}
          trailing={
            <Pressable
              onPress={() => onChange(times.filter((_, j) => j !== i))}
              accessibilityLabel={`Remove ${formatClock(t)}`}
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-full active:bg-surface"
            >
              <Icon icon={X} size={18} tone="muted" />
            </Pressable>
          }
        />
      ))}
      <Row
        onPress={() => open("new")}
        leading={<Icon icon={Plus} size={20} tone="accent" />}
        title={<Txt weight="medium" tone="accent" className="text-base">Add a time</Txt>}
      />
      <TimePickerSheet
        key={round}
        visible={editing !== null}
        initial={initial}
        onClose={() => setEditing(null)}
        onDone={done}
      />
    </View>
  );
}
