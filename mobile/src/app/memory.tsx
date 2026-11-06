// What Finlyt remembers about your money: monthly income, commitments (like money to family for
// something they paid for, with income rules and how much is paid off), and notes. Finlyt saves these when
// you tell it in Ask or a check-in; here you can see them, change the income, pause or delete.
import { router } from "expo-router";
import { HandHeart, MessageSquareText, StickyNote, Trash2, Wallet } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from "react-native";

import { Meter } from "@/components/charts";
import { Button, Icon, IconButton, SectionLabel, Txt } from "@/components/ui";
import { formatPaise } from "@/lib/money";
import { useChangeCommitment, useDeleteCommitment, useDeleteNote, useMemory, useSetIncome } from "@/lib/queries";
import { fonts, useTheme } from "@/lib/theme";
import type { Commitment } from "@/lib/types";

function rulesText(c: Commitment): string | null {
  if (!c.rules.length) return null;
  return c.rules
    .map((r) => (r.min_income_paise ? `${formatPaise(r.monthly_paise)} once income is ${formatPaise(r.min_income_paise)}` : `${formatPaise(r.monthly_paise)} to start`))
    .join(" · ");
}

export default function Memory() {
  const { colors } = useTheme();
  const memory = useMemory();
  const setIncome = useSetIncome();
  const change = useChangeCommitment();
  const removeCommitment = useDeleteCommitment();
  const removeNote = useDeleteNote();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const m = memory.data;

  async function saveIncome() {
    const rupees = parseInt(draft.replace(/\D/g, ""), 10);
    setError(null);
    try {
      await setIncome.mutateAsync(Number.isNaN(rupees) || rupees <= 0 ? null : rupees * 100);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function confirmDelete(c: Commitment) {
    Alert.alert(`Forget “${c.title}”?`, "Finlyt stops setting it aside in your check-ins.", [
      { text: "Cancel", style: "cancel" },
      { text: "Forget", style: "destructive", onPress: () => removeCommitment.mutate(c.id) },
    ]);
  }

  if (memory.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pb-12 pt-2" keyboardShouldPersistTaps="handled">
      <Txt tone="muted" className="text-base leading-6">
        Finlyt uses this in your check-ins and when you ask about your money. To add or change something, just tell
        Finlyt, like “I give my sister ₹3,000 a month for the laptop”.
      </Txt>
      {memory.error ? (
        <Txt tone="danger" className="mt-4 text-sm">
          {memory.error.message}
        </Txt>
      ) : null}

      <SectionLabel className="mb-2 mt-8">Income</SectionLabel>
      <View className="rounded-3xl bg-surface p-4">
        <View className="flex-row items-center gap-3">
          <Icon icon={Wallet} size={20} tone="muted" />
          {editing ? (
            <View className="flex-1 flex-row items-center">
              <Txt weight="semibold" className="text-xl">
                ₹
              </Txt>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                keyboardType="number-pad"
                autoFocus
                placeholder="Monthly take-home"
                placeholderTextColor={colors.faint}
                onSubmitEditing={() => void saveIncome()}
                className="flex-1 py-0 text-xl text-fg"
                style={{ fontFamily: fonts.semibold }}
              />
            </View>
          ) : (
            <Pressable
              className="flex-1"
              onPress={() => {
                setDraft(m?.monthly_income_paise ? String(m.monthly_income_paise / 100) : "");
                setEditing(true);
              }}
            >
              <Txt weight="semibold" className="text-xl">
                {m?.monthly_income_paise ? `${formatPaise(m.monthly_income_paise)} a month` : "Not known yet"}
              </Txt>
              <Txt tone="muted" className="text-xs">
                {m?.income_note ? `${m.income_note} · ` : ""}tap to change
              </Txt>
            </Pressable>
          )}
        </View>
        {editing ? (
          <View className="mt-3 flex-row gap-2">
            <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} className="flex-1" />
            <Button label="Save" onPress={() => void saveIncome()} loading={setIncome.isPending} className="flex-1" />
          </View>
        ) : null}
        {m?.after_commitments_paise != null ? (
          <Txt tone="muted" className="mt-3 text-sm">
            {formatPaise(m.after_commitments_paise)} a month left after commitments.
          </Txt>
        ) : null}
        {error ? (
          <Txt tone="danger" className="mt-2 text-sm">
            {error}
          </Txt>
        ) : null}
      </View>
      {setIncome.data?.updates?.length ? (
        <Txt tone="muted" className="mt-2 text-sm leading-5">
          {setIncome.data.updates.map((u) => u.text).join("\n")}
        </Txt>
      ) : null}

      <SectionLabel className="mb-2 mt-8">Every month</SectionLabel>
      {m?.commitments.length ? (
        <View className="gap-3">
          {m.commitments.map((c) => (
            <View key={c.id} className="rounded-3xl bg-surface p-4" style={{ opacity: c.active ? 1 : 0.6 }}>
              <View className="flex-row items-start gap-3">
                <Icon icon={HandHeart} size={20} tone="muted" />
                <View className="flex-1">
                  <Txt weight="semibold" className="text-base">
                    {c.title}
                  </Txt>
                  <Txt className="mt-0.5">
                    {formatPaise(c.monthly_paise)} a month
                    {c.active ? "" : " · paused"}
                    {c.done ? " · paid off" : ""}
                  </Txt>
                  {rulesText(c) ? (
                    <Txt tone="muted" className="mt-1 text-xs leading-4">
                      {rulesText(c)}
                    </Txt>
                  ) : null}
                </View>
                <IconButton icon={Trash2} label={`Forget ${c.title}`} tone="muted" onPress={() => confirmDelete(c)} />
              </View>
              {c.total_paise ? (
                <View className="mt-3">
                  <Meter ratio={c.paid_paise / c.total_paise} />
                  <Txt tone="muted" className="mt-1.5 text-xs">
                    {formatPaise(c.paid_paise)} of {formatPaise(c.total_paise)} paid
                    {c.done ? "" : c.months_left ? ` · about ${c.months_left} ${c.months_left === 1 ? "month" : "months"} left` : ""}
                  </Txt>
                </View>
              ) : null}
              <Pressable onPress={() => change.mutate({ id: c.id, active: !c.active })} hitSlop={6} className="mt-3 self-start">
                <Txt weight="medium" tone="accent" className="text-sm">
                  {c.active ? "Pause it" : "Start it again"}
                </Txt>
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <Txt tone="muted" className="text-sm">
          Nothing yet. Money you give or pay every month (family, an EMI, rent) goes here.
        </Txt>
      )}

      <SectionLabel className="mb-2 mt-8">Notes</SectionLabel>
      {m?.notes.length ? (
        <View className="-mx-1">
          {m.notes.map((n) => (
            <View key={n.id} className="flex-row items-center gap-3 px-1 py-1.5">
              <Icon icon={StickyNote} size={18} tone="muted" />
              <Txt className="flex-1 text-sm leading-5">{n.text}</Txt>
              <IconButton icon={Trash2} label="Forget this note" tone="muted" onPress={() => removeNote.mutate(n.id)} />
            </View>
          ))}
        </View>
      ) : (
        <Txt tone="muted" className="text-sm">
          Nothing yet.
        </Txt>
      )}

      <Button label="Tell Finlyt something" icon={MessageSquareText} variant="secondary" onPress={() => router.push("/ask")} className="mt-10" />
    </ScrollView>
  );
}
