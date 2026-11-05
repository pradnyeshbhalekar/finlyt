import { ScrollView, Text } from "react-native";

import { Card, Muted, Screen, Title } from "@/components/ui";
import { isoDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { useStats } from "@/lib/queries";

// Per-person balances and settling paybacks come in phase 6; dues are already recorded.
export default function Owed() {
  const today = isoDate(new Date());
  const stats = useStats(today, today);

  return (
    <Screen>
      <ScrollView contentContainerClassName="p-4 pb-28">
        <Title>Owed to you</Title>
        <Card className="mt-4">
          <Muted>Total outstanding</Muted>
          <Text className="mt-1 text-3xl font-bold text-ink dark:text-white">
            {formatPaise(stats.data?.open_dues_paise ?? 0)}
          </Text>
          <Muted className="mt-3">
            A breakdown by person, and matching paybacks from your UPI credits, is coming.
          </Muted>
        </Card>
      </ScrollView>
    </Screen>
  );
}
