// Who owes you what, from the open dues on your expenses. Settling paybacks comes in phase 6;
// for now, type "Rahul paid me back 200" on Home.
import { ScrollView, View } from "react-native";

import { Coin } from "@/components/brand";
import { Row, SectionLabel, Txt } from "@/components/ui";
import { formatPaise } from "@/lib/money";
import { useExpenses } from "@/lib/queries";

export default function Owed() {
  const list = useExpenses({ limit: 500 });

  const byPerson = new Map<string, number>();
  for (const expense of list.data?.items ?? []) {
    for (const due of expense.dues) {
      if (due.status !== "open") continue;
      const left = due.amount_paise - due.settled_paise;
      if (left > 0) byPerson.set(due.person_name, (byPerson.get(due.person_name) ?? 0) + left);
    }
  }
  const people = [...byPerson.entries()].sort((a, b) => b[1] - a[1]);
  const total = people.reduce((sum, [, amount]) => sum + amount, 0);

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pb-16">
      <Txt tone="muted" className="mt-2 text-sm">
        Total
      </Txt>
      <Txt weight="bold" className="text-5xl" style={{ letterSpacing: -1 }}>
        {formatPaise(total)}
      </Txt>

      {people.length > 0 ? (
        <>
          <SectionLabel className="mb-2 mt-8">People</SectionLabel>
          <View className="-mx-3">
            {people.map(([name, amount]) => (
              <Row
                key={name}
                leading={
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-surface">
                    <Txt weight="semibold" tone="muted">
                      {name.charAt(0).toUpperCase()}
                    </Txt>
                  </View>
                }
                title={name}
                trailing={<Txt weight="semibold">{formatPaise(amount)}</Txt>}
              />
            ))}
          </View>
          <Txt tone="muted" className="mt-6 text-sm leading-5">
            When someone pays you back, say so on Home, like “Rahul paid me back 200”.
          </Txt>
        </>
      ) : list.isLoading ? null : (
        <View className="mt-12 items-center">
          <Coin size={56} variant="bare" mood="happy" />
          <Txt tone="muted" className="mt-3">
            Nobody owes you anything.
          </Txt>
        </View>
      )}
    </ScrollView>
  );
}
