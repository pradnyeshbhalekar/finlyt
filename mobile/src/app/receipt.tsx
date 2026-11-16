// A scanned receipt: "Does this look right?" with what Finlyt read (the shop, the total, the day),
// and the one question worth asking here: does anyone owe you for it, and how is it split (equal,
// you pay 25% or 75%, they pay all, or your own amounts). Save logs it like any entry; "Edit
// details" opens the full check screen for anything else. Opened from + → Scan a receipt on Home
// (lib/receipt-draft holds the scan, so a slow read survives leaving and notifies you).
import { Image } from "expo-image";
import { router, useNavigation } from "expo-router";
import { CircleAlert, Pencil, Plus, ScanLine, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

import { Coin } from "@/components/brand";
import { CategoryBadge } from "@/components/category-icon";
import { KeyboardAware } from "@/components/keyboard";
import { Button, Chip, Icon, Segmented, SectionLabel, Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { whenLabel } from "@/lib/dates";
import { isUndoable, proposalToCommit, savedMessage } from "@/lib/log";
import { logDraft } from "@/lib/log-draft";
import { formatPaise, parseRupees } from "@/lib/money";
import { useCommitLog, useMeta } from "@/lib/queries";
import { receiptDraft, useReceiptDraft } from "@/lib/receipt-draft";
import { SLOW_NOTE, useSlow } from "@/lib/reply-alert";
import { checkSplit, describeSplit, SPLITS, splitDues, type SplitMode } from "@/lib/split";
import { fonts, useTheme } from "@/lib/theme";
import type { Proposal } from "@/lib/types";

function withDues(p: Proposal, dues: { person_name: string; amount_paise: number }[]): Proposal {
  const [first, ...rest] = p.expenses;
  const owed = dues.reduce((sum, d) => sum + d.amount_paise, 0);
  return { ...p, expenses: [{ ...first, dues, my_share_paise: first.total_paise - owed }, ...rest] };
}

/** Kept with the entry (note_raw), so the items show up when you search later. */
function receiptNote(p: Proposal): string {
  return p.transcript ? `Receipt: ${p.transcript}` : "Scanned receipt";
}

export default function Receipt() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation();
  const draft = useReceiptDraft();
  const meta = useMeta();
  const commit = useCommitLog();
  const slow = useSlow(draft.reading);

  const [someone, setSomeone] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [typing, setTyping] = useState("");
  const [mode, setMode] = useState<SplitMode>("equal");
  const [custom, setCustom] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    receiptDraft.enter(user?.id ?? null);
  }, [user?.id]);
  // A reading that arrives while you're elsewhere notifies you; tapping it brings you back here.
  useEffect(() => {
    receiptDraft.watch(() => navigation.isFocused());
    return () => receiptDraft.watch(null);
  }, [navigation]);

  const proposal = draft.proposal;
  const expense = proposal?.expenses[0] ?? null;
  const accounts = new Map((meta.data?.accounts ?? []).map((a) => [a.id, a]));
  const categories = new Map((meta.data?.categories ?? []).map((c) => [c.id, c]));
  const category = expense?.category_id != null ? categories.get(expense.category_id)?.name : undefined;
  const paidWith = expense?.payments.map((p) => accounts.get(p.account_id)?.name ?? "Account").join(" + ");
  const total = expense?.total_paise ?? 0;

  // A name typed but not added yet still counts.
  const people = someone ? (typing.trim() ? [...names, typing.trim()] : names) : [];
  const dues = splitDues(
    total,
    mode,
    people.length,
    people.map((_, i) => (custom[i] ? parseRupees(custom[i]) : null)),
  );
  const known = (meta.data?.people ?? [])
    .map((p) => p.name)
    .filter((n) => !names.some((x) => x.toLowerCase() === n.toLowerCase()))
    .slice(0, 8);

  function addName(name: string) {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean || names.some((n) => n.toLowerCase() === clean.toLowerCase())) return;
    setNames([...names, clean]);
    setTyping("");
    setError(null);
  }

  function removeName(i: number) {
    setNames(names.filter((_, j) => j !== i));
    setCustom(custom.filter((_, j) => j !== i));
  }

  async function scanAgain() {
    setError(null);
    const result = await receiptDraft.scan();
    if (result.error) setError(result.error);
  }

  function close() {
    receiptDraft.reset();
    router.back();
  }

  async function save() {
    if (!proposal || !expense) return;
    const split = someone ? checkSplit(total, people, dues) : { dues: [] };
    if ("error" in split) {
      setError(split.error);
      return;
    }
    if (someone && people.length === 0) {
      setError("Add who owes you, or pick “Just me”.");
      return;
    }
    setError(null);
    const body = proposalToCommit(withDues(proposal, split.dues), receiptNote(proposal));
    try {
      const result = await commit.mutateAsync(body);
      router.back();
      logDraft.saved({
        message: savedMessage(body),
        expenseIds: result.expense_ids,
        input: "",
        questions: [],
        undoable: isUndoable(body),
      });
      receiptDraft.reset();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function editDetails() {
    if (!proposal) return;
    const split = someone ? checkSplit(total, people, dues) : { dues: [] };
    const held = withDues(proposal, "dues" in split ? split.dues : []);
    logDraft.hold({ proposal: held, input: receiptNote(proposal) });
    receiptDraft.reset();
    router.replace("/log/review");
  }

  const thumb = draft.pages[0] ? (
    <Image
      source={{ uri: draft.pages[0] }}
      contentFit="cover"
      style={{ width: 64, height: 86, borderRadius: 12, backgroundColor: colors.surface }}
      accessibilityLabel="Your scanned receipt"
    />
  ) : null;

  // Nothing scanned (opened from a stale notification, say): offer to scan.
  if (!draft.reading && !proposal && !draft.error && draft.pages.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <Icon icon={ScanLine} size={32} tone="accent" />
        <Txt weight="semibold" className="mt-4 text-center text-lg">
          Scan a receipt
        </Txt>
        <Txt tone="muted" className="mt-1 text-center">
          Finlyt reads the shop, the total and the date. You say who owes you.
        </Txt>
        {error ? (
          <Txt tone="danger" className="mt-3 text-center text-sm">
            {error}
          </Txt>
        ) : null}
        <Button label="Scan" icon={ScanLine} onPress={() => void scanAgain()} className="mt-6 self-stretch" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-8 pt-4" keyboardShouldPersistTaps="handled">
        {draft.reading ? (
          <Animated.View entering={FadeIn.duration(200)} className="flex-row items-center gap-4 rounded-3xl bg-surface p-4">
            {thumb}
            <View className="flex-1">
              <View className="flex-row items-center gap-2">
                <Coin size={28} mood="thinking" variant="bare" />
                <Txt weight="semibold" className="text-base">
                  Reading your receipt…
                </Txt>
              </View>
              <Txt tone="muted" className="mt-1 text-sm">
                {slow ? SLOW_NOTE : "Finding the shop, the total and the date."}
              </Txt>
            </View>
          </Animated.View>
        ) : null}

        {!draft.reading && (draft.error || (proposal && !expense)) ? (
          <Animated.View entering={FadeIn.duration(200)} className="rounded-3xl bg-surface p-4">
            <View className="flex-row gap-4">
              {thumb}
              <View className="flex-1">
                <Txt weight="semibold" className="text-base">
                  Couldn&apos;t read that receipt
                </Txt>
                <Txt tone="muted" className="mt-1 text-sm leading-5">
                  {draft.error ?? proposal?.questions[0] ?? "Try scanning it again in better light."}
                </Txt>
              </View>
            </View>
            <View className="mt-4 flex-row gap-3">
              {draft.error ? (
                <Button label="Try again" variant="secondary" onPress={receiptDraft.retry} className="flex-1" />
              ) : null}
              <Button label="Scan again" icon={ScanLine} onPress={() => void scanAgain()} className="flex-1" />
            </View>
          </Animated.View>
        ) : null}

        {!draft.reading && expense ? (
          <>
            <Animated.View entering={FadeInDown.duration(320)} className="rounded-3xl bg-surface p-4">
              <Txt weight="semibold" className="text-lg">
                Does this look right?
              </Txt>
              <View className="mt-3 flex-row gap-4">
                {thumb}
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <CategoryBadge name={category} size={28} />
                    <Txt weight="medium" className="flex-1 text-base" numberOfLines={2}>
                      {expense.description}
                    </Txt>
                  </View>
                  <Txt weight="bold" className="mt-2 text-3xl" style={{ letterSpacing: -0.6 }}>
                    {formatPaise(total)}
                  </Txt>
                  <Txt tone="muted" className="mt-1 text-sm">
                    {[whenLabel(expense.occurred_at), category, paidWith].filter(Boolean).join(" · ")}
                  </Txt>
                </View>
              </View>
              {proposal?.transcript ? (
                <Txt tone="faint" className="mt-3 text-sm" numberOfLines={2}>
                  {proposal.transcript}
                </Txt>
              ) : null}
              {expense.issues.map((issue, i) => (
                <View key={i} className="mt-2 flex-row gap-2">
                  <Icon icon={CircleAlert} size={16} tone="muted" />
                  <Txt tone="warn" className="flex-1 text-sm">
                    {issue}
                  </Txt>
                </View>
              ))}
              <Pressable
                onPress={editDetails}
                accessibilityRole="button"
                hitSlop={8}
                className="mt-3 flex-row items-center gap-1.5 self-start py-1"
              >
                <Icon icon={Pencil} size={15} tone="accent" />
                <Txt weight="medium" tone="accent" className="text-sm">
                  Something&apos;s off? Edit details
                </Txt>
              </Pressable>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(80).duration(320)}>
              <Txt weight="semibold" className="mb-3 mt-7 text-base">
                Does anyone owe you for this?
              </Txt>
              <Segmented
                options={[
                  { value: "no", label: "Just me" },
                  { value: "yes", label: "Someone owes me" },
                ]}
                value={someone ? "yes" : "no"}
                onChange={(v) => {
                  setSomeone(v === "yes");
                  setError(null);
                }}
              />

              {someone ? (
                <Animated.View entering={FadeIn.duration(200)}>
                  <SectionLabel className="mb-3 mt-6">Who</SectionLabel>
                  {names.length ? (
                    <View className="mb-1 flex-row flex-wrap">
                      {names.map((n, i) => (
                        <Pressable
                          key={n}
                          onPress={() => removeName(i)}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${n}`}
                          className="mb-2 mr-2 h-9 flex-row items-center gap-1.5 rounded-full bg-brand pl-3 pr-2"
                        >
                          <Txt weight="medium" tone="onBrand" className="text-sm">
                            {n}
                          </Txt>
                          <X size={14} color="#FFFFFF" strokeWidth={2} />
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  <View className="h-12 flex-row items-center rounded-2xl bg-surface pl-4 pr-1">
                    <TextInput
                      value={typing}
                      onChangeText={setTyping}
                      onSubmitEditing={() => addName(typing)}
                      placeholder={names.length ? "Add someone else" : "Their name"}
                      placeholderTextColor={colors.faint}
                      returnKeyType="done"
                      autoCapitalize="words"
                      blurOnSubmit={false}
                      className="flex-1 text-base text-fg"
                      style={{ fontFamily: fonts.regular }}
                    />
                    {typing.trim() ? (
                      <Pressable
                        onPress={() => addName(typing)}
                        accessibilityRole="button"
                        accessibilityLabel="Add"
                        className="h-10 w-10 items-center justify-center rounded-full active:bg-bg"
                      >
                        <Icon icon={Plus} size={20} tone="accent" />
                      </Pressable>
                    ) : null}
                  </View>
                  {known.length ? (
                    <View className="mt-3 flex-row flex-wrap">
                      {known.map((n) => (
                        <Chip key={n} label={n} selected={false} onPress={() => addName(n)} />
                      ))}
                    </View>
                  ) : null}

                  <SectionLabel className="mb-3 mt-6">How do you split it?</SectionLabel>
                  <View className="flex-row flex-wrap">
                    {SPLITS.map((s) => (
                      <Chip
                        key={s.mode}
                        label={s.mode === "equal" && people.length === 1 ? "Half each" : s.label}
                        selected={mode === s.mode}
                        onPress={() => {
                          setMode(s.mode);
                          setError(null);
                        }}
                      />
                    ))}
                  </View>
                  {mode === "custom"
                    ? people.map((n, i) => (
                        <View key={`${n}-${i}`} className="mt-2 flex-row items-center gap-3">
                          <Txt className="flex-1 text-base" numberOfLines={1}>
                            {n} owes you
                          </Txt>
                          <View className="h-12 w-32 flex-row items-center rounded-2xl bg-surface px-3">
                            <Txt weight="semibold">₹</Txt>
                            <TextInput
                              value={custom[i] ?? ""}
                              onChangeText={(v) => {
                                const next = [...custom];
                                next[i] = v;
                                setCustom(next);
                              }}
                              keyboardType="decimal-pad"
                              placeholder="0"
                              placeholderTextColor={colors.faint}
                              className="ml-1 flex-1 text-base text-fg"
                              style={{ fontFamily: fonts.semibold }}
                            />
                          </View>
                        </View>
                      ))
                    : null}
                  {people.length ? (
                    <Txt tone="muted" className="mt-3 text-sm leading-5">
                      {describeSplit(total, people, dues)}
                    </Txt>
                  ) : (
                    <Txt tone="faint" className="mt-1 text-sm">
                      Add who owes you to see the split.
                    </Txt>
                  )}
                </Animated.View>
              ) : null}
            </Animated.View>
          </>
        ) : null}
      </ScrollView>

      <KeyboardAware>
        <View className="px-5 pt-2">
          {error ? (
            <Txt tone="danger" className="mb-2 text-sm">
              {error}
            </Txt>
          ) : null}
          {expense && !draft.reading ? (
            <Button label={`Save ${formatPaise(total)}`} onPress={() => void save()} loading={commit.isPending} />
          ) : (
            <Button label={draft.reading ? "Cancel" : "Close"} variant="secondary" onPress={close} />
          )}
        </View>
      </KeyboardAware>
    </View>
  );
}
