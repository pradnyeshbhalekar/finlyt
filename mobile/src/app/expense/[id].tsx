// One entry, as a sheet that opens at half height (drag up for all of it, down to close): what it
// was, how much was yours, how it was paid, who owes you, and the words it came from. Opened by
// tapping an entry on Home or in History.
import { router, useLocalSearchParams } from "expo-router";
import { Check, MessageSquareQuote, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CategoryBadge } from "@/components/category-icon";
import { DayChips } from "@/components/day-picker";
import { Divider, Icon, IconButton, Row, SectionLabel, Txt } from "@/components/ui";
import { isoDate, moveToDay, timeLabel } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { useDeleteExpense, useExpense, useMeta, useUpdateExpense } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import { confirmDelete as askDelete } from "@/lib/ask-sheet";

const appear = (i: number) => FadeInDown.delay(60 * i).duration(320);

const SOURCE: Record<string, string> = {
  log: "Logged by voice or text",
  manual: "Added by hand",
  import: "Imported from Claude",
};

/** Android's sheet has no grabber of its own, and in Dark and Ink the edge needs a hint. */
function Grabber() {
  return (
    <View className="items-center pb-1 pt-3">
      <View className="h-1 w-10 rounded-full bg-line" />
    </View>
  );
}

export default function ExpenseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const expense = useExpense(Number(id));
  const meta = useMeta();
  const remove = useDeleteExpense();
  const update = useUpdateExpense();
  const [changingDay, setChangingDay] = useState(false);

  const e = expense.data;
  if (!e) {
    return (
      <View>
        <Grabber />
        <View className="h-64 items-center justify-center px-8">
          {expense.error ? (
            <Txt tone="muted" className="text-center">
              {expense.error.message}
            </Txt>
          ) : (
            <ActivityIndicator color={colors.muted} />
          )}
        </View>
      </View>
    );
  }

  const entry = e;
  const accounts = new Map((meta.data?.accounts ?? []).map((a) => [a.id, a]));
  const category = entry.category_id != null ? meta.data?.categories.find((c) => c.id === entry.category_id) : undefined;
  const when = new Date(entry.occurred_at);
  const day = when.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const split = entry.my_share_paise !== entry.total_paise;

  function confirmDelete() {
    askDelete("Delete this entry?", `${entry.description} · ${formatPaise(entry.my_share_paise)}`, () => {
      void remove.mutateAsync(entry.id).then(() => router.back());
    });
  }

  return (
    <View className="flex-1">
      <Grabber />
      <ScrollView
        nestedScrollEnabled
        contentContainerClassName="px-6 pt-2"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 16 }}
      >
        {/* The top fits in half a screen: what, how much, when. */}
        <Animated.View entering={appear(0)} className="flex-row items-center gap-3">
          <CategoryBadge name={category?.name} size={44} />
          <View className="flex-1">
            <Txt tone="muted" className="text-sm">
              {category?.name ?? "Uncategorised"}
            </Txt>
            <Txt weight="semibold" className="text-lg" numberOfLines={2}>
              {entry.description}
            </Txt>
          </View>
          <IconButton icon={Trash2} label="Delete entry" onPress={confirmDelete} tone="danger" disabled={remove.isPending} />
        </Animated.View>

        <Animated.View entering={appear(1)}>
          <Txt weight="bold" className="mt-4 text-5xl" style={{ letterSpacing: -1.5, lineHeight: 56 }}>
            {formatPaise(entry.my_share_paise)}
          </Txt>
          <Txt tone="muted" className="mt-1 text-base">
            {split ? `Your share of ${formatPaise(entry.total_paise)} · ` : ""}
            {day}, {timeLabel(entry.occurred_at)}
          </Txt>
          {/* Logged on the wrong day (forgot yesterday's)? Move it. Bank SMS entries keep the bank's date. */}
          {!entry.payments.some((p) => p.bank_txn_id) ? (
            changingDay ? (
              <View className="mt-3">
                <DayChips
                  value={isoDate(when)}
                  onPick={(pick) => {
                    setChangingDay(false);
                    update.mutate({ id: entry.id, occurred_at: moveToDay(entry.occurred_at, pick) });
                  }}
                />
              </View>
            ) : (
              <Pressable onPress={() => setChangingDay(true)} hitSlop={6} className="mt-2 self-start">
                <Txt weight="medium" tone="accent" className="text-sm">
                  {update.isPending ? "Moving…" : "Change date"}
                </Txt>
              </Pressable>
            )
          ) : null}
        </Animated.View>

        <Divider className="my-5" />

        <Animated.View entering={appear(2)}>
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
          <Animated.View entering={appear(3)}>
            <SectionLabel className="mb-1 mt-5">Owed to you</SectionLabel>
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
          <Animated.View entering={appear(4)}>
            <SectionLabel className="mb-3 mt-5">What you said</SectionLabel>
            <View className="flex-row gap-3 rounded-3xl bg-surface p-4">
              <Icon icon={MessageSquareQuote} size={18} tone="muted" />
              <Txt className="flex-1 text-base" style={{ lineHeight: 23 }}>
                {entry.note_raw}
              </Txt>
            </View>
          </Animated.View>
        ) : null}

        <Txt tone="faint" className="mt-6 text-xs">
          {SOURCE[entry.source] ?? "Added"} on{" "}
          {new Date(entry.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })},{" "}
          {timeLabel(entry.created_at)}
        </Txt>
      </ScrollView>
    </View>
  );
}
