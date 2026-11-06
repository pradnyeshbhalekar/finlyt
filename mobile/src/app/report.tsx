// The full month report ("where did my money go"), opened from Ask Finlyt, Plan and Home. Arrows
// step to earlier months; the questions at the bottom go to Ask Finlyt.
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";

import { ReportView } from "@/components/month-report";
import { IconButton, SectionLabel, Txt } from "@/components/ui";
import { useMonthReport } from "@/lib/queries";
import { useTheme } from "@/lib/theme";

function shift(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const QUESTIONS = ["Is that more than usual?", "Anything else I'm missing?", "How much should I save?"];

export default function Report() {
  const params = useLocalSearchParams<{ month?: string }>();
  const { colors } = useTheme();
  const [month, setMonth] = useState(params.month ?? thisMonth());
  const report = useMonthReport(month);
  const latest = month >= thisMonth();
  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pb-12 pt-2">
      <View className="-mx-2 mb-4 flex-row items-center justify-between">
        <IconButton icon={ChevronLeft} label="Earlier month" onPress={() => setMonth(shift(month, -1))} />
        <Txt weight="semibold" className="text-lg">
          {label}
        </Txt>
        <IconButton icon={ChevronRight} label="Later month" onPress={() => setMonth(shift(month, 1))} disabled={latest} />
      </View>
      {report.isPending ? (
        <View className="mt-16 items-center">
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : report.error ? (
        <Txt tone="danger" className="mt-6">
          {report.error.message}
        </Txt>
      ) : report.data ? (
        <ReportView report={report.data} />
      ) : null}

      <SectionLabel className="mb-3 mt-10">Ask about {label.split(" ")[0]}</SectionLabel>
      <View className="gap-2">
        {QUESTIONS.map((q) => (
          <Pressable
            key={q}
            onPress={() => router.push({ pathname: "/ask", params: { q: `${q} (${label})` } })}
            className="self-start rounded-full border border-line px-4 py-2.5 active:bg-surface"
          >
            <Txt className="text-sm">{q}</Txt>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
