// Bank payments picked up from SMS, waiting to be explained. Tap one and the composer asks
// "What was Zomato?"; long-press to mark it as a transfer, income or not spending. Three show at
// first (plus the one you picked), to keep Home calm; "See all" shows the rest.
import { MessageSquareText } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { dateTimeLabel } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import type { Account, BankTxnItem } from "@/lib/types";
import { askSheet } from "@/lib/ask-sheet";

import { Button, Icon, SectionLabel, Txt } from "./ui";

export function ToLog({
  txns,
  accounts,
  selectedId,
  onSelect,
  onResolve,
}: {
  txns: BankTxnItem[];
  accounts: Map<number, Account>;
  selectedId: number | null;
  onSelect: (txn: BankTxnItem | null) => void;
  onResolve: (txn: BankTxnItem, status: "transfer" | "ignored" | "income") => void;
}) {
  const [all, setAll] = useState(false);
  if (txns.length === 0) return null;
  const shown = all ? txns : txns.filter((t, i) => i < 3 || t.id === selectedId);

  function askResolve(t: BankTxnItem) {
    const credit = t.direction === "credit";
    askSheet({
      title: credit ? `${formatPaise(t.amount_paise)} from ${t.name}` : `${formatPaise(t.amount_paise)} to ${t.name}`,
      message: credit
        ? "If it's someone paying you back, tap it and say so instead."
        : "Not something you spent on? Mark it so it leaves To log.",
      actions: [
        credit
          ? { label: "It's income", onPress: () => onResolve(t, "income") }
          : { label: "Moved to my own account", onPress: () => onResolve(t, "transfer") },
        { label: "Ignore it", danger: true, onPress: () => onResolve(t, "ignored") },
      ],
    });
  }

  return (
    <View className="mt-8">
      <SectionLabel>To log · {txns.length}</SectionLabel>
      <View className="-mx-3 mt-2">
        {shown.map((t) => {
          const selected = t.id === selectedId;
          const credit = t.direction === "credit";
          const account = accounts.get(t.account_id)?.name;
          return (
            <Pressable
              key={t.id}
              onPress={() => onSelect(selected ? null : t)}
              onLongPress={() => askResolve(t)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              className={`min-h-14 flex-row items-center gap-3 rounded-2xl px-3 py-3 ${
                selected ? "bg-surface" : "active:bg-surface"
              }`}
            >
              <View className="flex-1">
                <Txt weight="medium" className="text-base" numberOfLines={1}>
                  {credit ? `From ${t.name}` : t.name}
                </Txt>
                <Txt tone="muted" className="mt-0.5 text-sm" numberOfLines={1}>
                  {[dateTimeLabel(t.occurred_at), t.channel.toUpperCase(), account].filter(Boolean).join(" · ")}
                </Txt>
              </View>
              <Txt weight="semibold" tone={credit ? "accent" : "fg"} className="text-base">
                {credit ? "+" : ""}
                {formatPaise(t.amount_paise)}
              </Txt>
              <View className={`h-2 w-2 rounded-full ${selected ? "bg-brand" : ""}`} />
            </Pressable>
          );
        })}
      </View>
      {txns.length > shown.length || all ? (
        <Pressable onPress={() => setAll(!all)} hitSlop={6} className="mt-1 self-start py-1">
          <Txt weight="medium" tone="accent" className="text-sm">
            {all ? "Show fewer" : `See all ${txns.length}`}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/** One-time ask for SMS access, explaining that only bank messages are used. */
export function SmsPermissionCard({ onAllow, onDismiss }: { onAllow: () => void; onDismiss: () => void }) {
  return (
    <View className="mt-6 rounded-3xl bg-surface p-4">
      <View className="flex-row items-center gap-3">
        <Icon icon={MessageSquareText} size={22} tone="accent" />
        <Txt weight="semibold" className="flex-1 text-base">
          Pick up bank payments
        </Txt>
      </View>
      <Txt tone="muted" className="mt-2 text-sm leading-5">
        Finlyt can read your Kotak and DNS Bank SMS and list each UPI payment here for you to explain.
        Other messages never leave your phone.
      </Txt>
      <View className="mt-4 flex-row gap-3">
        <Button label="Not now" variant="ghost" onPress={onDismiss} className="flex-1" />
        <Button label="Allow" onPress={onAllow} className="flex-1" />
      </View>
    </View>
  );
}
