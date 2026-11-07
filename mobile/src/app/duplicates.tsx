// Possible duplicates: the same day and amount twice, where at least one came from an import (for
// example the same Claude chat imported twice). Delete the extra copy; a group disappears once
// only one is left. Opened from History.
import { router } from "expo-router";
import { CircleCheck, Trash2 } from "lucide-react-native";
import { ActivityIndicator, Alert, ScrollView, View } from "react-native";

import { CategoryBadge } from "@/components/category-icon";
import { Button, Icon, IconButton, SectionLabel, Txt } from "@/components/ui";
import { dayLabel, timeLabel } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { useDeleteExpense, useDuplicates, useMeta } from "@/lib/queries";
import { useTheme } from "@/lib/theme";

const SOURCE = { import: "Imported", log: "Logged", manual: "Added by hand" } as const;

export default function Duplicates() {
  const { colors } = useTheme();
  const dupes = useDuplicates();
  const meta = useMeta();
  const remove = useDeleteExpense();
  const categories = new Map((meta.data?.categories ?? []).map((c) => [c.id, c.name]));
  const groups = dupes.data?.groups ?? [];

  function confirmDelete(id: number, what: string) {
    Alert.alert("Delete this copy?", what, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate(id) },
    ]);
  }

  if (dupes.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pb-12 pt-2">
      {groups.length === 0 ? (
        <View className="mt-16 items-center">
          <Icon icon={CircleCheck} size={40} tone="accent" />
          <Txt weight="semibold" className="mt-4 text-xl">
            No duplicates
          </Txt>
          <Txt tone="muted" className="mt-2 text-center text-base leading-6">
            Nothing shows up twice for the same day and amount.
          </Txt>
          <Button label="Back to History" variant="secondary" onPress={() => router.back()} className="mt-8 self-stretch" />
        </View>
      ) : (
        <>
          <Txt tone="muted" className="text-base leading-6">
            These look like the same expense twice, often from importing the same chat more than once. Delete the
            extra copy and keep one. If both are real, leave them.
          </Txt>
          {groups.map((g) => (
            <View key={`${g.day}-${g.total_paise}`} className="mt-7">
              <View className="mb-2 flex-row items-baseline justify-between">
                <SectionLabel>{dayLabel(g.day)}</SectionLabel>
                <Txt weight="semibold">{formatPaise(g.total_paise)} each</Txt>
              </View>
              <View className="overflow-hidden rounded-3xl bg-surface">
                {g.items.map((item, i) => (
                  <View key={item.id} className={`flex-row items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
                    <CategoryBadge name={item.category_id != null ? categories.get(item.category_id) : null} size={34} />
                    <View className="flex-1">
                      <Txt weight="medium" numberOfLines={1}>
                        {item.description}
                      </Txt>
                      <Txt tone="muted" className="text-xs">
                        {SOURCE[item.source]} · {timeLabel(item.occurred_at)}
                      </Txt>
                    </View>
                    <IconButton
                      icon={Trash2}
                      label={`Delete ${item.description}`}
                      tone="muted"
                      onPress={() => confirmDelete(item.id, `${item.description} · ${formatPaise(g.total_paise)}`)}
                    />
                  </View>
                ))}
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}
