// Your accounts: the ways you pay. Everyone starts with Bank and Cash, and which bank doesn't
// matter much; you can still rename, add, pick the usual one (used when you don't say how you
// paid) and delete. People who joined before 2026-11-14 got Kotak and DNS Bank; a card offers to
// fold every bank account into one "Bank". From Settings → Logging.
import { Banknote, Check, Landmark, Plus } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, ScrollView, TextInput, View } from "react-native";

import { Group, GroupItem, GroupLabel } from "@/components/group";
import { Button, Chip, Icon, Sheet, Txt } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { askSheet, confirmDelete } from "@/lib/ask-sheet";
import { useAddAccount, useChangeAccount, useDeleteAccount, useMeta, useOneBank } from "@/lib/queries";
import { fonts, useTheme } from "@/lib/theme";
import type { Account } from "@/lib/types";

function explain(e: unknown): string {
  if (e instanceof ApiError && (e.status === 404 || e.status === 405) && e.code !== "not_found") {
    return "Changing accounts isn't switched on for your Finlyt server yet. It needs one more backend deploy.";
  }
  return (e as Error).message;
}

function NameBox({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const { colors } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="Credit card, wallet"
      placeholderTextColor={colors.faint}
      maxLength={40}
      autoFocus
      className="mt-1.5 h-12 rounded-2xl bg-surface px-4 text-base text-fg"
      style={{ fontFamily: fonts.regular }}
    />
  );
}

export default function Accounts() {
  const { colors } = useTheme();
  const meta = useMeta();
  const add = useAddAccount();
  const change = useChangeAccount();
  const remove = useDeleteAccount();
  const oneBank = useOneBank();
  const accounts = meta.data?.accounts ?? [];
  const banks = accounts.filter((a) => a.kind === "bank");
  const [mergeError, setMergeError] = useState<string | null>(null);

  function askOneBank() {
    const names = banks.map((a) => a.name);
    const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    askSheet({
      title: "Use one bank account?",
      message: `${list} become one account called Bank, with all their entries. Cash stays as it is. This can't be undone.`,
      actions: [
        {
          label: "Use one bank account",
          onPress: () => {
            setMergeError(null);
            oneBank.mutate(undefined, { onError: (e) => setMergeError(explain(e)) });
          },
        },
      ],
    });
  }

  // The account being changed, or "new" while adding one.
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Account["kind"]>("bank");
  const [error, setError] = useState<string | null>(null);

  function open(target: Account | "new") {
    setEditing(target);
    setName(target === "new" ? "" : target.name);
    setKind("bank");
    setError(null);
  }

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      setEditing(null);
    } catch (e) {
      setError(explain(e));
    }
  }

  const account = editing && editing !== "new" ? editing : null;
  const busy = add.isPending || change.isPending || remove.isPending;
  const valid = name.trim().length > 0;

  if (!meta.data) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        {meta.error ? (
          <Txt tone="muted" className="text-center">
            {meta.error.message}
          </Txt>
        ) : (
          <ActivityIndicator color={colors.muted} />
        )}
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-5 pb-16">
      <Txt tone="muted" className="mt-2 text-base leading-6">
        The ways you pay: Bank (UPI and cards) and Cash. Say “cash” when you paid in cash; otherwise Finlyt uses your
        usual one.
      </Txt>

      {banks.length > 1 ? (
        <View className="mt-5 rounded-3xl bg-surface p-4">
          <Txt weight="semibold" className="text-base">
            One bank account is enough
          </Txt>
          <Txt tone="muted" className="mt-1 text-sm leading-5">
            Which bank you paid from doesn&apos;t matter much. {banks.map((a) => a.name).join(" and ")} can become one
            account called Bank, with all their entries.
          </Txt>
          {mergeError ? (
            <Txt tone="danger" className="mt-2 text-sm">
              {mergeError}
            </Txt>
          ) : null}
          <Button label="Use one bank account" onPress={askOneBank} loading={oneBank.isPending} className="mt-3" />
        </View>
      ) : null}

      <GroupLabel>Your accounts</GroupLabel>
      <Group>
        {accounts.map((a, i) => (
          <GroupItem
            key={a.id}
            first={i === 0}
            icon={a.kind === "cash" ? Banknote : Landmark}
            title={a.name}
            subtitle={a.is_primary ? "Your usual one" : undefined}
            trailing={a.is_primary ? <Icon icon={Check} size={16} tone="accent" /> : undefined}
            onPress={() => open(a)}
          />
        ))}
        <GroupItem first={accounts.length === 0} icon={Plus} title="Add an account" onPress={() => open("new")} />
      </Group>

      <Sheet visible={editing !== null} onClose={() => setEditing(null)}>
        <Txt weight="semibold" className="text-xl">
          {account ? account.name : "New account"}
        </Txt>
        <Txt tone="muted" className="mt-4 text-sm">
          Name
        </Txt>
        {/* A new key per account, so the box starts with that account's name. */}
        <NameBox key={account?.id ?? "new"} value={name} onChange={setName} />
        {editing === "new" ? (
          <View className="mt-4 flex-row">
            <Chip label="Bank, card or UPI" icon={Landmark} selected={kind === "bank"} onPress={() => setKind("bank")} />
            <Chip label="Cash" icon={Banknote} selected={kind === "cash"} onPress={() => setKind("cash")} />
          </View>
        ) : null}
        {error ? (
          <Txt tone="danger" className="mt-3 text-sm">
            {error}
          </Txt>
        ) : null}
        <Button
          label={account ? "Save name" : "Add account"}
          disabled={!valid || busy}
          loading={add.isPending || (change.isPending && !change.variables?.is_primary)}
          onPress={() =>
            void run(() =>
              account ? change.mutateAsync({ id: account.id, name: name.trim() }) : add.mutateAsync({ name: name.trim(), kind }),
            )
          }
          className="mt-5"
        />
        {account && !account.is_primary ? (
          <Button
            label="Make this my usual account"
            variant="secondary"
            disabled={busy}
            onPress={() => void run(() => change.mutateAsync({ id: account.id, is_primary: true }))}
            className="mt-3"
          />
        ) : null}
        {account && accounts.length > 1 ? (
          <Button
            label="Delete account"
            variant="danger"
            disabled={busy}
            onPress={() => {
              setEditing(null);
              confirmDelete(`Delete ${account.name}?`, "Only an account with no entries can be deleted.", () =>
                remove.mutate(account.id, {
                  onError: (e) => {
                    // Say why (it has entries) on the account's own sheet.
                    open(account);
                    setError(explain(e));
                  },
                }),
              );
            }}
            className="mt-1"
          />
        ) : null}
      </Sheet>
    </ScrollView>
  );
}
