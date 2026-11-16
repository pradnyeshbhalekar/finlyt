// A small ⓘ next to a label that explains it in a sheet. Used in the month report, where words
// like "On pace for" and the marks on the bars need a line of explanation.
import { Info } from "lucide-react-native";
import { Pressable, View } from "react-native";

import type { HelpTopic } from "@/lib/report-help";

import { Button, Icon, Sheet, Txt } from "./ui";

export function InfoButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`What is ${label}?`}
      hitSlop={12}
      className="h-5 w-5 items-center justify-center rounded-full active:opacity-50"
    >
      <Icon icon={Info} size={14} tone="faint" />
    </Pressable>
  );
}

/** `topic` stays set while the sheet fades out, so only `visible` opens and closes it. */
export function InfoSheet({ visible, topic, onClose }: { visible: boolean; topic: HelpTopic; onClose: () => void }) {
  const shown = topic;
  return (
    <Sheet visible={visible} onClose={onClose}>
      {shown ? (
        <View>
          <View className="flex-row items-center gap-2">
            <Icon icon={Info} size={20} tone="accent" />
            <Txt weight="semibold" className="text-xl">
              {shown.title}
            </Txt>
          </View>
          {shown.lines.map((line, i) => (
            <Txt key={i} tone={i === 0 ? "fg" : "muted"} className="mt-3 text-base leading-6">
              {line}
            </Txt>
          ))}
          <Button label="Got it" variant="secondary" onPress={onClose} className="mt-6" />
        </View>
      ) : null}
    </Sheet>
  );
}
