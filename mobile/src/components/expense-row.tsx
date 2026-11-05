import { View } from "react-native";

import { timeLabel } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import type { Account, Category, Expense } from "@/lib/types";

import { CategoryBadge } from "./category-icon";
import { Row, Txt } from "./ui";

export function ExpenseRow({
  expense,
  accounts,
  categories,
  onPress,
  onLongPress,
}: {
  expense: Expense;
  accounts: Map<number, Account>;
  categories: Map<number, Category>;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const category = expense.category_id != null ? categories.get(expense.category_id) : undefined;
  const paidWith = expense.payments.map((p) => accounts.get(p.account_id)?.name ?? "Account").join(" + ");
  const owers = expense.dues.map((d) => d.person_name).join(", ");
  const isSplit = expense.my_share_paise !== expense.total_paise;

  return (
    <Row
      onPress={onPress}
      onLongPress={onLongPress}
      leading={<CategoryBadge name={category?.name} />}
      title={expense.description}
      subtitle={`${timeLabel(expense.occurred_at)} · ${paidWith}${owers ? ` · ${owers} owes you` : ""}`}
      trailing={
        <View className="items-end">
          <Txt weight="semibold" className="text-base">
            {formatPaise(expense.my_share_paise)}
          </Txt>
          {isSplit ? (
            <Txt tone="muted" className="text-xs">
              of {formatPaise(expense.total_paise)}
            </Txt>
          ) : null}
        </View>
      }
    />
  );
}
