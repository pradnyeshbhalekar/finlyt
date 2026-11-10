// Import from an AI chat: bring in the spending you tracked in Claude, ChatGPT or Gemini.
// 1. Pick the chat and copy the prompt (it lists your categories and accounts).
// 2. Paste it into that conversation, then paste the reply back here.
// 3. Check the preview (already-logged entries come unticked) and import. One tap undoes it.
// Opened from onboarding and from Settings.
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { Check, ClipboardPaste, Copy, ExternalLink, Undo2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, SectionList, TextInput, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Coin } from "@/components/brand";
import { CategoryBadge } from "@/components/category-icon";
import { Button, Icon, SectionLabel, Txt } from "@/components/ui";
import { dayHeading } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { fetchImportPrompt, useImportBatches, useImportCommit, useImportPreview, useMeta, useUndoImport } from "@/lib/queries";
import { importGate } from "@/lib/import-gate";
import { fonts, useTheme } from "@/lib/theme";
import type { ImportEntry, ImportPreview, ImportResult, ImportSource } from "@/lib/types";
import { confirmDelete as askDelete } from "@/lib/ask-sheet";

const SOURCES: { value: ImportSource; label: string; url: string | null }[] = [
  { value: "claude", label: "Claude", url: "https://claude.ai/new" },
  { value: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com" },
  { value: "gemini", label: "Gemini", url: "https://gemini.google.com/app" },
  { value: "other", label: "Other", url: null },
];

const appear = (i: number) => FadeInDown.delay(70 * i).duration(380);

function StepNumber({ n, done }: { n: number; done: boolean }) {
  return (
    <View className={`h-7 w-7 items-center justify-center rounded-full ${done ? "bg-brand" : "bg-surface"}`}>
      {done ? (
        <Check size={15} color="#FFFFFF" strokeWidth={2.5} />
      ) : (
        <Txt weight="semibold" tone="muted" className="text-sm">
          {n}
        </Txt>
      )}
    </View>
  );
}

function shortDay(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** What an entry is, in a few words, under its description. */
function detail(e: ImportEntry, accountName: (id: number) => string): string {
  switch (e.kind) {
    case "payback":
      return `${e.person_name} paid you back`;
    case "owe":
      return `${e.person_name} paid, you owe them`;
    case "repay":
      return `You paid ${e.person_name} back`;
    case "expense": {
      const paid = [...new Set(e.payments.map((p) => accountName(p.account_id)))].join(" + ");
      const owed = e.dues.map((d) => `${d.person_name} owes ${formatPaise(d.amount_paise)}`).join(", ");
      const linked = e.payments.some((p) => p.bank_txn_id) ? "matched to a bank payment" : null;
      return [paid, owed || null, linked].filter(Boolean).join(" · ");
    }
    default:
      return e.skip_reason ? `Not imported: ${e.skip_reason}` : "Not imported";
  }
}

export default function ImportScreen() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromOnboarding = from === "onboarding";
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const meta = useMeta();
  const read = useImportPreview();
  const save = useImportCommit();
  const undo = useUndoImport();
  const batches = useImportBatches();

  function confirmUndo(id: number, what: string) {
    askDelete("Undo this import?", `${what}. Everything it added is removed.`, () => undo.mutate(id), "Undo import");
  }
  const [source, setSource] = useState<ImportSource>("claude");
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [include, setInclude] = useState<Record<number, boolean>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accounts = useMemo(() => new Map((meta.data?.accounts ?? []).map((a) => [a.id, a.name])), [meta.data]);
  const categories = useMemo(() => new Map((meta.data?.categories ?? []).map((c) => [c.id, c.name])), [meta.data]);
  const chat = SOURCES.find((s) => s.value === source)!;

  /** Leave the import. From onboarding there may be no screen behind this one (so "back" did
   *  nothing): go on to onboarding's last step instead. */
  function leave() {
    if (fromOnboarding) {
      router.replace({ pathname: "/onboarding", params: { step: "plan" } });
      setTimeout(importGate.close, 600); // once onboarding is showing, Import isn't reachable again
    } else if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  async function copyPrompt() {
    setError(null);
    try {
      const { prompt } = await fetchImportPrompt();
      await Clipboard.setStringAsync(prompt);
      setCopied(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function pasteReply() {
    const pasted = await Clipboard.getStringAsync();
    if (pasted.trim()) setText(pasted);
  }

  async function readReply() {
    setError(null);
    try {
      const data = await read.mutateAsync({ text, source });
      setPreview(data);
      setInclude(Object.fromEntries(data.entries.map((e) => [e.index, e.include])));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const chosen = preview ? preview.entries.filter((e) => e.kind !== "skip" && include[e.index]) : [];

  async function importChosen() {
    if (!preview) return;
    setError(null);
    try {
      setResult(await save.mutateAsync({ entries: chosen, source, rawText: text }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function undoImport() {
    if (!result) return;
    setError(null);
    try {
      await undo.mutateAsync(result.batch_id);
      setUndone(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // ── Done ──
  if (result) {
    return (
      <View className="flex-1 bg-bg px-6 pt-8">
        <Animated.View entering={appear(0)}>
          <Coin size={64} variant="bare" mood={undone ? "default" : "happy"} />
        </Animated.View>
        <Animated.View entering={appear(1)}>
          <Txt weight="bold" className="mt-6 text-3xl" style={{ letterSpacing: -0.5 }}>
            {undone ? "Import undone" : `Imported ${result.imported} ${result.imported === 1 ? "entry" : "entries"}`}
          </Txt>
          <Txt tone="muted" className="mt-2 text-base leading-6">
            {undone
              ? "Everything from that import is gone, and any bank payments it matched are back in To log."
              : "They're in your history now, and Finlyt's check-ins will use them to see how your weeks go."}
          </Txt>
        </Animated.View>
        {!undone && result.skipped.length > 0 ? (
          <Animated.View entering={appear(2)} className="mt-6">
            <SectionLabel>Left out</SectionLabel>
            {result.skipped.map((s) => (
              <Txt key={s.index} tone="muted" className="mt-2 text-sm leading-5">
                {s.description}: {s.reason}
              </Txt>
            ))}
          </Animated.View>
        ) : null}
        {error ? (
          <Txt tone="danger" className="mt-4 text-sm">
            {error}
          </Txt>
        ) : null}
        <View className="flex-1" />
        <View className="gap-3" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
          <Button label={fromOnboarding ? "Continue" : "Done"} onPress={leave} />
          {!undone ? (
            <Button label="Undo this import" icon={Undo2} variant="ghost" onPress={() => void undoImport()} loading={undo.isPending} />
          ) : null}
        </View>
      </View>
    );
  }

  // ── Preview ──
  if (preview) {
    const days = new Map<string, ImportEntry[]>();
    for (const e of preview.entries.filter((x) => x.kind !== "skip")) {
      days.set(e.day!, [...(days.get(e.day!) ?? []), e]);
    }
    const sections = [...days.entries()].map(([day, data]) => ({ day, data }));
    const skipped = preview.entries.filter((e) => e.kind === "skip");
    const { summary } = preview;
    return (
      <View className="flex-1 bg-bg">
        <SectionList
          sections={sections}
          keyExtractor={(e) => String(e.index)}
          contentContainerClassName="px-5 pb-6"
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View className="pt-4">
              <Txt weight="bold" className="text-3xl" style={{ letterSpacing: -0.5 }}>
                {summary.importable} {summary.importable === 1 ? "entry" : "entries"}
              </Txt>
              <Txt tone="muted" className="mt-1 text-base">
                {summary.first_day ? `${shortDay(summary.first_day)} to ${shortDay(summary.last_day)} · ` : ""}
                {formatPaise(summary.spent_paise)} spent
              </Txt>
              {preview.repaired ? (
                <Txt tone="warn" className="mt-3 text-sm leading-5">
                  The reply wasn&apos;t quite in the format, so Finlyt tidied it up. Check the entries below.
                </Txt>
              ) : null}
              {summary.duplicates > 0 ? (
                <Txt tone="muted" className="mt-3 text-sm leading-5">
                  {summary.duplicates} {summary.duplicates === 1 ? "looks" : "look"} already logged, so{" "}
                  {summary.duplicates === 1 ? "it's" : "they're"} unticked. Tick to import anyway.
                </Txt>
              ) : null}
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View className="mb-1 mt-6 flex-row items-baseline justify-between px-1">
              <SectionLabel>{dayHeading(section.day)}</SectionLabel>
              <Txt tone="muted" className="text-sm">
                {formatPaise(
                  section.data
                    .filter((e) => e.kind === "expense" && include[e.index])
                    .reduce((sum, e) => sum + (e.my_share_paise ?? 0), 0),
                )}
              </Txt>
            </View>
          )}
          renderItem={({ item: e }) => {
            const on = !!include[e.index];
            return (
              <Pressable
                onPress={() => setInclude((m) => ({ ...m, [e.index]: !on }))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                className="flex-row items-center gap-3 rounded-2xl px-1 py-2.5 active:bg-surface"
              >
                <View
                  className={`h-6 w-6 items-center justify-center rounded-md ${on ? "bg-brand" : "border-2 border-line"}`}
                >
                  {on ? <Check size={14} color="#FFFFFF" strokeWidth={3} /> : null}
                </View>
                <CategoryBadge name={e.category_id != null ? categories.get(e.category_id) : null} size={34} />
                <View className="flex-1" style={{ opacity: on ? 1 : 0.55 }}>
                  <Txt weight="medium" numberOfLines={1}>
                    {e.description}
                  </Txt>
                  <Txt tone="muted" className="text-xs" numberOfLines={2}>
                    {e.duplicate ? "Looks already logged · " : ""}
                    {detail(e, (id) => accounts.get(id) ?? "")}
                  </Txt>
                  {e.warnings.map((w, i) => (
                    <Txt key={i} tone="warn" className="text-xs">
                      {w}
                    </Txt>
                  ))}
                </View>
                <Txt weight="semibold" style={{ opacity: on ? 1 : 0.55 }}>
                  {e.kind === "payback" ? "+" : ""}
                  {formatPaise(e.kind === "expense" ? (e.my_share_paise ?? e.amount_paise) : e.amount_paise)}
                </Txt>
              </Pressable>
            );
          }}
          ListFooterComponent={
            skipped.length > 0 ? (
              <View className="mt-8 px-1">
                <SectionLabel>Not imported</SectionLabel>
                {skipped.map((e) => (
                  <Txt key={e.index} tone="muted" className="mt-2 text-sm">
                    {e.description} · {formatPaise(e.amount_paise)} · {e.skip_reason}
                  </Txt>
                ))}
              </View>
            ) : undefined
          }
        />
        <View className="border-t border-line px-5 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
          {error ? (
            <Txt tone="danger" className="mb-2 text-sm">
              {error}
            </Txt>
          ) : null}
          <Button
            label={chosen.length ? `Import ${chosen.length} ${chosen.length === 1 ? "entry" : "entries"}` : "Nothing ticked"}
            icon={Check}
            onPress={() => void importChosen()}
            loading={save.isPending}
            disabled={chosen.length === 0}
          />
          <Button label="Paste a different reply" variant="ghost" onPress={() => setPreview(null)} className="mt-1" />
        </View>
      </View>
    );
  }

  // ── Copy the prompt, paste the reply ──
  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View entering={appear(0)}>
          <Coin size={56} variant="bare" />
          <Txt weight="bold" className="mt-5 text-3xl" style={{ letterSpacing: -0.5 }}>
            Bring in your old chats
          </Txt>
          <Txt tone="muted" className="mt-2 text-base leading-6">
            Tracked your spending with an AI before? Finlyt can read it all in, splits and paybacks included.
          </Txt>
        </Animated.View>

        <Animated.View entering={appear(1)} className="mt-8 flex-row gap-3">
          <StepNumber n={1} done={copied} />
          <View className="flex-1">
            <Txt weight="semibold" className="text-base">
              Copy the prompt
            </Txt>
            <View className="mt-3 flex-row flex-wrap gap-2">
              {SOURCES.map((s) => (
                <Pressable
                  key={s.value}
                  onPress={() => setSource(s.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: s.value === source }}
                  className={`rounded-full px-4 py-2 ${s.value === source ? "bg-brand" : "bg-surface"}`}
                >
                  <Txt weight="medium" tone={s.value === source ? "onBrand" : "fg"} className="text-sm">
                    {s.label}
                  </Txt>
                </Pressable>
              ))}
            </View>
            <View className="mt-3 flex-row gap-2">
              <Button
                label={copied ? "Copied" : "Copy prompt"}
                icon={copied ? Check : Copy}
                variant={copied ? "secondary" : "primary"}
                onPress={() => void copyPrompt()}
                className="flex-1"
              />
              {chat.url ? (
                <Button
                  label={`Open ${chat.label}`}
                  icon={ExternalLink}
                  variant="secondary"
                  onPress={() => void Linking.openURL(chat.url!)}
                  className="flex-1"
                />
              ) : null}
            </View>
          </View>
        </Animated.View>

        <Animated.View entering={appear(2)} className="mt-8 flex-row gap-3">
          <StepNumber n={2} done={false} />
          <View className="flex-1">
            <Txt weight="semibold" className="text-base">
              Paste it into the chat
            </Txt>
            <Txt tone="muted" className="mt-1 text-sm leading-5">
              Use the same conversation where you told {source === "other" ? "the AI" : chat.label} what you spent. It
              answers with a list of everything.
            </Txt>
          </View>
        </Animated.View>

        <Animated.View entering={appear(3)} className="mt-8 flex-row gap-3">
          <StepNumber n={3} done={text.trim().length > 0} />
          <View className="flex-1">
            <Txt weight="semibold" className="text-base">
              Paste the reply here
            </Txt>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Copy the whole reply and paste it here"
              placeholderTextColor={colors.faint}
              multiline
              textAlignVertical="top"
              className="mt-3 h-36 rounded-2xl bg-surface p-3 text-sm text-fg"
              style={{ fontFamily: fonts.regular }}
            />
            <Pressable onPress={() => void pasteReply()} hitSlop={6} className="mt-2 flex-row items-center gap-1.5 self-start">
              <Icon icon={ClipboardPaste} size={16} tone="accent" />
              <Txt weight="medium" tone="accent" className="text-sm">
                Paste from clipboard
              </Txt>
            </Pressable>
          </View>
        </Animated.View>
        {error ? (
          <Txt tone="danger" className="mt-4 text-sm">
            {error}
          </Txt>
        ) : null}
        <View className="mt-6">
          {read.isPending ? (
            <View className="mb-3 flex-row items-center gap-3">
              <ActivityIndicator color={colors.muted} />
              <Txt tone="muted" className="text-sm">
                Reading the reply. A long chat can take a minute.
              </Txt>
            </View>
          ) : null}
          <Button
            label="Read the reply"
            onPress={() => void readReply()}
            loading={read.isPending}
            disabled={text.trim().length < 2}
          />
          {/* Earlier imports, each one undoable. */}
          {!fromOnboarding && (batches.data?.items.length ?? 0) > 0 ? (
            <View className="mt-10">
              <SectionLabel>Past imports</SectionLabel>
              <View className="mt-2 overflow-hidden rounded-3xl bg-surface">
                {(batches.data?.items ?? []).map((b, i) => {
                  const what = `${b.entry_count} ${b.entry_count === 1 ? "entry" : "entries"} from ${b.source_name}`;
                  return (
                    <View key={b.id} className={`flex-row items-center gap-3 px-4 py-3 ${i ? "border-t border-line" : ""}`}>
                      <View className="flex-1">
                        <Txt weight="medium">{what}</Txt>
                        {b.first_day ? (
                          <Txt tone="muted" className="text-xs">
                            {shortDay(b.first_day)} to {shortDay(b.last_day)}
                          </Txt>
                        ) : null}
                      </View>
                      <Pressable onPress={() => confirmUndo(b.id, what)} hitSlop={8} accessibilityRole="button">
                        <Txt weight="medium" tone="danger" className="text-sm">
                          Undo
                        </Txt>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}
          {/* Importing is optional: from onboarding, skipping goes on to the next step. */}
          {fromOnboarding ? (
            <Button label="Skip, I don't have one" variant="ghost" onPress={leave} className="mt-1" />
          ) : null}
        </View>
      </ScrollView>

    </View>
  );
}
