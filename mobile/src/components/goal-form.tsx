// The sheet for a new goal (or changing one): what it's for, how much, and an optional month to
// reach it by. Months are chips, so there's no date picker to fight with.
import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";

import { fonts, useTheme } from "@/lib/theme";

import { Button, Sheet, Txt } from "./ui";

function endOfMonth(offset: number): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function GoalForm({
  visible,
  title,
  initial,
  saving,
  error,
  onClose,
  onSave,
}: {
  visible: boolean;
  title: string;
  initial?: { name: string; target_paise: number; due_on: string | null };
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (goal: { name: string; target_paise: number; due_on: string | null }) => void;
}) {
  const { colors } = useTheme();
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(initial ? String(Math.round(initial.target_paise / 100)) : "");
  const [due, setDue] = useState<string | null>(initial?.due_on ?? null);
  const months = Array.from({ length: 12 }, (_, i) => endOfMonth(i + 1));
  const rupees = parseInt(amount.replace(/\D/g, ""), 10);
  const valid = name.trim().length > 0 && rupees > 0;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Txt weight="semibold" className="text-xl">
        {title}
      </Txt>
      <Txt tone="muted" className="mt-4 text-sm">
        What it&apos;s for
      </Txt>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Goa trip, a new phone, emergency fund"
        placeholderTextColor={colors.faint}
        className="mt-1.5 h-12 rounded-2xl bg-surface px-4 text-base text-fg"
        style={{ fontFamily: fonts.regular }}
      />
      <Txt tone="muted" className="mt-4 text-sm">
        How much
      </Txt>
      <View className="mt-1.5 h-12 flex-row items-center rounded-2xl bg-surface px-4">
        <Txt weight="semibold" className="text-base">
          ₹
        </Txt>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="number-pad"
          placeholder="15,000"
          placeholderTextColor={colors.faint}
          className="ml-1 flex-1 text-base text-fg"
          style={{ fontFamily: fonts.semibold }}
        />
      </View>
      <Txt tone="muted" className="mt-4 text-sm">
        By when
      </Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1 mt-1.5" contentContainerClassName="gap-2 px-1">
        {[null, ...months].map((m) => {
          const value = m ? iso(m) : null;
          const selected = (due ?? null) === value || (!!due && !!value && due.slice(0, 7) === value.slice(0, 7));
          const label = m ? m.toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "No date";
          return (
            <Pressable
              key={label}
              onPress={() => setDue(value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className={`rounded-full px-4 py-2 ${selected ? "bg-brand" : "border border-line"}`}
            >
              <Txt weight="medium" tone={selected ? "onBrand" : "fg"} className="text-sm">
                {label}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>
      {error ? (
        <Txt tone="danger" className="mt-3 text-sm">
          {error}
        </Txt>
      ) : null}
      <Button
        label="Save goal"
        onPress={() => onSave({ name: name.trim(), target_paise: rupees * 100, due_on: due })}
        loading={saving}
        disabled={!valid}
        className="mt-6"
      />
    </Sheet>
  );
}
