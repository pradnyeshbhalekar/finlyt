// One entry, full screen: what it was, how much was yours, how it was paid, who owes you, and the
// words it came from. Opened by tapping an entry on Home or in History.
import { router, useLocalSearchParams } from "expo-router";
import { Check, MessageSquareQuote, Trash2 } from "lucide-react-native";
import { ActivityIndicator, Alert, ScrollView, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CategoryBadge } from "@/components/category-icon";
import { Button, Divider, Icon, Row, SectionLabel, Txt } from "@/components/ui";
import { timeLabel } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { useDeleteExpense, useExpense, useMeta } from "@/lib/queries";
import { useTheme } from "@/lib/theme";

const appear = (i: number) => FadeInDown.delay(70 * i).duration(380);

const SOURCE: Record<string, string> = {
  log: "Logged by voice or text",
  manual: "Added by hand",
  import: "Imported from Claude",
};

export default function ExpenseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const expense = useExpense(Number(id));
  const meta = useMeta();
  const remove = useDeleteExpense();

  const e = expense.data;
  if (!e) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        {expense.error ? (
          <Txt tone="muted" className="text-center">
            {expense.error.message}
          </Txt>
        ) : (
          <ActivityIndicator color={colors.muted} />
        )}
      </View>
    );
  }

  const entry = e;
  const accounts = new Map((meta.data?.accounts ?? []).map((a) => [a.id, a]));
  const category = entry.category_id != null ? meta.data?.categories.find((c) => c.id === entry.category_id) : undefined;
  const when = new Date(entry.occurred_at);
  const day = when.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const split = entry.my_share_paise !== entry.total_paise;

  function confirmDelete() {
    Alert.alert("Delete this entry?", `${entry.description} · ${formatPaise(entry.my_share_paise)}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void remove.mutateAsync(entry.id).then(() => router.back());
        },
      },
    ]);
  }

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="px-6 pb-10 pt-2">
        <Animated.View entering={appear(0)}>
          <CategoryBadge name={category?.name} size={60} />
        </Animated.View>
        <Animated.View entering={appear(1)}>
          <Txt tone="muted" className="mt-5 text-sm">
            {category?.name ?? "Uncategorised"}
          </Txt>
          <Txt weight="semibold" className="mt-1 text-2xl" style={{ letterSpacing: -0.3 }}>
            {entry.description}
          </Txt>
        </Animated.View>
        <Animated.View entering={appear(2)}>
          <Txt weight="bold" className="mt-4 text-6xl" style={{ letterSpacing: -2, lineHeight: 68 }}>
            {formatPaise(entry.my_share_paise)}
          </Txt>
          {split ? (
            <Txt tone="muted" className="text-base">
              Your share of {formatPaise(entry.total_paise)}
            </Txt>
          ) : null}
          <Txt tone="muted" className="mt-2 text-base">
            {day} · {timeLabel(entry.occurred_at)}
          </Txt>
        </Animated.View>

        <Divider className="my-6" />

        <Animated.View entering={appear(3)}>
          <SectionLabel className="mb-1">Paid with</SectionLabel>
          <View className="-mx-3">
            {entry.payments.map((p) => (
              <Row
                key={p.id}
                title={accounts.get(p.account_id)?.name ?? "Account"}
                subtitle={p.bank_txn_id ? "Matched to a bank SMS" : undefined}
                trailing={
                  <View className="flex-row items-center gap-1.5">
                    {p.bank_txn_id ? <Icon icon={Check} size={16} tone="accent" /> : null}
                    <Txt weight="semibold">{formatPaise(p.amount_paise)}</Txt>
                  </View>
                }
              />
            ))}
          </View>
        </Animated.View>

        {entry.dues.length > 0 ? (
          <Animated.View entering={appear(4)}>
            <SectionLabel className="mb-1 mt-6">Owed to you</SectionLabel>
            <View className="-mx-3">
              {entry.dues.map((d) => {
                const left = d.amount_paise - d.settled_paise;
                return (
                  <Row
                    key={d.id}
                    leading={
                      <View className="h-10 w-10 items-center justify-center rounded-full bg-surface">
                        <Txt weight="semibold" tone="muted">
                          {d.person_name.charAt(0).toUpperCase()}
                        </Txt>
                      </View>
                    }
                    title={d.person_name}
                    subtitle={
                      d.status === "settled"
                        ? "Paid you back"
                        : d.settled_paise > 0
                          ? `${formatPaise(left)} still to come`
                          : "Not paid back yet"
                    }
                    trailing={
                      <Txt weight="semibold" tone={d.status === "settled" ? "accent" : "fg"}>
                        {formatPaise(d.amount_paise)}
                      </Txt>
                    }
                  />
                );
              })}
            </View>
          </Animated.View>
        ) : null}

        {entry.note_raw ? (
          <Animated.View entering={appear(5)}>
            <SectionLabel className="mb-3 mt-6">What you said</SectionLabel>
            <View className="flex-row gap-3 rounded-3xl bg-surface p-4">
              <Icon icon={MessageSquareQuote} size={18} tone="muted" />
              <Txt className="flex-1 text-base" style={{ lineHeight: 23 }}>
                {entry.note_raw}
              </Txt>
            </View>
          </Animated.View>
        ) : null}

        <Txt tone="faint" className="mt-8 text-xs">
          {SOURCE[entry.source] ?? "Added"} on{" "}
          {new Date(entry.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })},{" "}
          {timeLabel(entry.created_at)}
        </Txt>
      </ScrollView>

      <View className="px-6 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <Button label="Delete entry" icon={Trash2} variant="danger" onPress={confirmDelete} loading={remove.isPending} />
      </View>
    </View>
  );
}
