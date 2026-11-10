// Owed: who owes you, and whom you owe, with what each amount was for. To settle up, just say it
// on Home ("Rahul gave 200 back").
import { ActivityIndicator, ScrollView, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Coin } from "@/components/brand";
import { Row, SectionLabel, Txt } from "@/components/ui";
import { formatPaise } from "@/lib/money";
import { useBalances } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import type { Balances } from "@/lib/types";

function Person({ row, tone }: { row: Balances["owed_to_me"][number]; tone: "accent" | "fg" }) {
  return (
    <Row
      leading={
        <View className="h-10 w-10 items-center justify-center rounded-full bg-surface">
          <Txt weight="semibold" tone="muted">
            {row.name.charAt(0).toUpperCase()}
          </Txt>
        </View>
      }
      title={row.name}
      subtitle={row.items.map((i) => i.description).join(", ")}
      trailing={
        <Txt weight="semibold" tone={tone}>
          {formatPaise(row.amount_paise)}
        </Txt>
      }
    />
  );
}

export default function Owed() {
  const { colors } = useTheme();
  const balances = useBalances();
  const data = balances.data;

  if (!data) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        {balances.error ? (
          <Txt tone="muted" className="text-center">
            {balances.error.message}
          </Txt>
        ) : (
          <ActivityIndicator color={colors.muted} />
        )}
      </View>
    );
  }

  const theyOwe = data.owed_to_me.reduce((sum, r) => sum + r.amount_paise, 0);
  const iOwe = data.i_owe.reduce((sum, r) => sum + r.amount_paise, 0);

  if (theyOwe === 0 && iOwe === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <Coin size={56} variant="bare" mood="happy" />
        <Txt tone="muted" className="mt-3 text-center">
          All square. Nobody owes anybody.
        </Txt>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pb-16">
      <Animated.View entering={FadeInDown.duration(380)}>
        <View className="mt-2 flex-row gap-3">
          <View className="flex-1 rounded-3xl bg-surface p-4">
            <Txt tone="muted" className="text-sm">
              Owed to you
            </Txt>
            <Txt weight="bold" tone="accent" className="mt-1 text-2xl">
              {formatPaise(theyOwe)}
            </Txt>
          </View>
          <View className="flex-1 rounded-3xl bg-surface p-4">
            <Txt tone="muted" className="text-sm">
              You owe
            </Txt>
            <Txt weight="bold" className="mt-1 text-2xl">
              {formatPaise(iOwe)}
            </Txt>
          </View>
        </View>
      </Animated.View>

      {data.owed_to_me.length > 0 ? (
        <Animated.View entering={FadeInDown.delay(80).duration(380)}>
          <SectionLabel className="mb-1 mt-8">They owe you</SectionLabel>
          <View className="-mx-3">
            {data.owed_to_me.map((row) => (
              <Person key={row.person_id} row={row} tone="accent" />
            ))}
          </View>
        </Animated.View>
      ) : null}

      {data.i_owe.length > 0 ? (
        <Animated.View entering={FadeInDown.delay(160).duration(380)}>
          <SectionLabel className="mb-1 mt-8">You owe them</SectionLabel>
          <View className="-mx-3">
            {data.i_owe.map((row) => (
              <Person key={row.person_id} row={row} tone="fg" />
            ))}
          </View>
        </Animated.View>
      ) : null}

      <Txt tone="muted" className="mt-8 text-sm leading-5">
        To settle up, just say it on Home, like “Rahul gave 200 back” or “paid Aaditya his 200”.
      </Txt>
    </ScrollView>
  );
}
