// Gemini's reading of what you typed, shown for a one-tap check before saving.
import { ArrowLeftRight, Check, CircleAlert, HandCoins, Pencil, UserRound, X } from "lucide-react-native";
import { View } from "react-native";

import { isoDate, whenLabel } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import type { Account, Category, Proposal } from "@/lib/types";

import { CategoryBadge } from "./category-icon";
import { DayChips } from "./day-picker";
import { Button, Icon, IconButton, Txt } from "./ui";

export function ProposalCard({
  proposal,
  accounts,
  categories,
  saving,
  onSave,
  onEdit,
  onDiscard,
  onMoveDay,
}: {
  proposal: Proposal;
  accounts: Map<number, Account>;
  categories: Map<number, Category>;
  saving: boolean;
  onSave: () => void;
  onEdit: () => void;
  onDiscard: () => void;
  /** Move the entries that aren't from a bank SMS to another day (keeping their time). */
  onMoveDay?: (day: string) => void;
}) {
  const count =
    proposal.expenses.length +
    proposal.settlements.length +
    proposal.transfers.length +
    proposal.ignored.length +
    (proposal.debts?.length ?? 0) +
    (proposal.repayments?.length ?? 0);
  const txnLabel = (id: number) => proposal.txns.find((t) => t.id === id);
  // The day can be changed for entries that aren't from a bank SMS (those keep the bank's time).
  const movable = proposal.expenses.find((e) => !e.payments.some((p) => p.bank_txn_id));

  return (
    <View className="rounded-3xl bg-surface p-4">
      <View className="mb-1 flex-row items-center justify-between">
        <Txt weight="semibold" className="text-base">
          {count === 1 ? "Look right?" : `${count} entries. Look right?`}
        </Txt>
        <IconButton icon={X} label="Discard" onPress={onDiscard} tone="muted" disabled={saving} />
      </View>

      {onMoveDay && movable ? (
        <View className="mb-1 mt-1">
          <DayChips value={isoDate(new Date(movable.occurred_at))} onPick={onMoveDay} />
        </View>
      ) : null}

      {proposal.expenses.map((e, i) => {
        const paid = e.payments.map((p) => accounts.get(p.account_id)?.name ?? "Account").join(" + ");
        const owed = e.dues.map((d) => `${d.person_name} owes ${formatPaise(d.amount_paise)}`).join(", ");
        const category = e.category_id != null ? categories.get(e.category_id)?.name : undefined;
        return (
          <View key={`e${i}`} className="flex-row gap-3 py-2.5">
            <CategoryBadge name={category} size={36} />
            <View className="flex-1">
              <Txt weight="medium" className="text-base" numberOfLines={2}>
                {e.description}
              </Txt>
              <Txt tone="muted" className="mt-0.5 text-sm">
                {[whenLabel(e.occurred_at), category, paid, owed].filter(Boolean).join(" · ")}
              </Txt>
              {e.issues.map((issue, j) => (
                <Txt key={j} tone="warn" className="mt-1 text-sm">
                  {issue}
                </Txt>
              ))}
            </View>
            <View className="items-end">
              <Txt weight="semibold" className="text-base">
                {formatPaise(e.my_share_paise)}
              </Txt>
              {e.my_share_paise !== e.total_paise ? (
                <Txt tone="muted" className="text-xs">
                  of {formatPaise(e.total_paise)}
                </Txt>
              ) : null}
            </View>
          </View>
        );
      })}

      {proposal.settlements.map((s, i) => (
        <View key={`s${i}`} className="flex-row items-center gap-3 py-2.5">
          <View className="h-9 w-9 items-center justify-center rounded-full bg-bg">
            <Icon icon={HandCoins} size={17} tone="muted" />
          </View>
          <View className="flex-1">
            <Txt weight="medium" className="text-base">
              {s.person_name} paid you back
            </Txt>
            <Txt tone="muted" className="text-sm">
              {s.txn_label ? "By UPI" : "Cash"}
            </Txt>
            {s.issues.map((issue, j) => (
              <Txt key={j} tone="warn" className="mt-1 text-sm">
                {issue}
              </Txt>
            ))}
          </View>
          <Txt weight="semibold" className="text-base">
            {formatPaise(s.amount_paise)}
          </Txt>
        </View>
      ))}

      {(proposal.debts ?? []).map((d, i) => (
        <View key={`d${i}`} className="flex-row items-center gap-3 py-2.5">
          <View className="h-9 w-9 items-center justify-center rounded-full bg-bg">
            <Icon icon={UserRound} size={17} tone="muted" />
          </View>
          <View className="flex-1">
            <Txt weight="medium" className="text-base">
              You owe {d.person_name}
            </Txt>
            <Txt tone="muted" className="text-sm">
              {d.description} · saved as owed, counted when you pay it back
            </Txt>
          </View>
          <Txt weight="semibold" className="text-base">
            {formatPaise(d.amount_paise)}
          </Txt>
        </View>
      ))}

      {(proposal.repayments ?? []).map((r, i) => (
        <View key={`r${i}`} className="flex-row items-center gap-3 py-2.5">
          <View className="h-9 w-9 items-center justify-center rounded-full bg-bg">
            <Icon icon={HandCoins} size={17} tone="muted" />
          </View>
          <View className="flex-1">
            <Txt weight="medium" className="text-base">
              You paid {r.person_name} back
            </Txt>
            <Txt tone="muted" className="text-sm">
              {r.txn_label ? "By UPI" : "Cash"}
            </Txt>
            {r.issues.map((issue, j) => (
              <Txt key={j} tone="warn" className="mt-1 text-sm">
                {issue}
              </Txt>
            ))}
          </View>
          <Txt weight="semibold" className="text-base">
            {formatPaise(r.amount_paise)}
          </Txt>
        </View>
      ))}

      {[...proposal.transfers.map((t) => ({ ...t, kind: "Transfer" })), ...proposal.ignored.map((t) => ({ ...t, kind: "Ignore" }))].map(
        (t, i) => {
          const txn = txnLabel(t.bank_txn_id);
          return (
            <View key={`t${i}`} className="flex-row items-center gap-3 py-2.5">
              <View className="h-9 w-9 items-center justify-center rounded-full bg-bg">
                <Icon icon={ArrowLeftRight} size={17} tone="muted" />
              </View>
              <View className="flex-1">
                <Txt weight="medium" className="text-base">
                  {t.kind} {txn?.counterparty ?? t.txn_label}
                </Txt>
                <Txt tone="muted" className="text-sm">
                  {t.reason}
                </Txt>
              </View>
              {txn ? <Txt weight="semibold">{formatPaise(txn.amount_paise)}</Txt> : null}
            </View>
          );
        },
      )}

      {proposal.questions.length > 0 ? (
        <View className="mt-1 gap-1.5">
          {proposal.questions.map((q, i) => (
            <View key={i} className="flex-row gap-2">
              <Icon icon={CircleAlert} size={16} tone="muted" />
              <Txt tone="muted" className="flex-1 text-sm">
                {q}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}

      <View className="mt-4 flex-row gap-3">
        <Button label="Edit" icon={Pencil} variant="secondary" onPress={onEdit} disabled={saving} className="flex-1" />
        <Button label="Save" icon={Check} onPress={onSave} loading={saving} className="flex-1" />
      </View>
    </View>
  );
}
