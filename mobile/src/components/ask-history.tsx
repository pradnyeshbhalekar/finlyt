// Past Ask Finlyt chats, like Claude's chat list: New chat and a search box at the top, then
// chats grouped by when they were last used. Long-press a chat to delete it. The server deletes
// chats nobody has touched for `keep_days` (10), and the footer says so.
import { Search, SquarePen } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, useWindowDimensions, View } from "react-native";

import { Sheet, Txt } from "@/components/ui";
import { timeLabel } from "@/lib/dates";
import { useAskThreads, useDeleteAskThread } from "@/lib/queries";
import { fonts, useTheme, WHITE } from "@/lib/theme";
import type { AskThreadSummary } from "@/lib/types";

const GROUPS = ["Today", "Yesterday", "Previous 7 days", "Older"] as const;
type Group = (typeof GROUPS)[number];

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function groupOf(iso: string, now: Date): Group {
  const days = Math.round((dayStart(now) - dayStart(new Date(iso))) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 7) return "Previous 7 days";
  return "Older";
}

function whenLabel(iso: string, group: Group): string {
  if (group === "Today" || group === "Yesterday") return timeLabel(iso);
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function AskHistory({
  visible,
  currentId,
  onClose,
  onOpen,
  onNew,
  onDeleted,
}: {
  visible: boolean;
  currentId: number | null;
  onClose: () => void;
  onOpen: (id: number) => void;
  onNew: () => void;
  onDeleted: (id: number) => void;
}) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const threads = useAskThreads(visible);
  const remove = useDeleteAskThread();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = (threads.data?.items ?? []).filter(
      (t) => !q || t.title.toLowerCase().includes(q) || t.preview.toLowerCase().includes(q),
    );
    const now = new Date();
    const byGroup = new Map<Group, AskThreadSummary[]>();
    for (const t of items) {
      const g = groupOf(t.updated_at, now);
      byGroup.set(g, [...(byGroup.get(g) ?? []), t]);
    }
    return GROUPS.filter((g) => byGroup.has(g)).map((g) => ({ group: g, items: byGroup.get(g)! }));
  }, [threads.data, query]);

  function confirmDelete(t: AskThreadSummary) {
    Alert.alert("Delete this chat?", t.title, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => remove.mutate(t.id, { onSuccess: () => onDeleted(t.id) }),
      },
    ]);
  }

  function close() {
    setQuery("");
    onClose();
  }

  const keepDays = threads.data?.keep_days ?? 10;
  const empty = !threads.isPending && !threads.error && groups.length === 0;

  return (
    <Sheet visible={visible} onClose={close}>
      <View style={{ height: Math.round(height * 0.72) }}>
        <View className="flex-row items-center justify-between">
          <Txt weight="bold" className="text-2xl" style={{ letterSpacing: -0.4 }}>
            Chats
          </Txt>
          <Pressable
            onPress={() => {
              setQuery("");
              onNew();
            }}
            accessibilityRole="button"
            className="h-11 flex-row items-center gap-2 rounded-full bg-brand px-4 active:opacity-80"
          >
            <SquarePen size={18} color={WHITE} strokeWidth={2} />
            <Txt weight="semibold" tone="onBrand" className="text-sm">
              New chat
            </Txt>
          </Pressable>
        </View>

        <View className="mt-4 h-11 flex-row items-center gap-2 rounded-full bg-surface px-4">
          <Search size={18} color={colors.faint} strokeWidth={1.75} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search chats"
            placeholderTextColor={colors.faint}
            returnKeyType="search"
            className="flex-1 py-0 text-base text-fg"
            style={{ fontFamily: fonts.regular }}
          />
        </View>

        <ScrollView className="mt-2 flex-1" contentContainerClassName="pb-2" keyboardShouldPersistTaps="handled">
          {threads.isPending ? (
            <View className="mt-10">
              <ActivityIndicator color={colors.muted} />
            </View>
          ) : null}
          {threads.error ? (
            <Txt tone="danger" className="mt-6 text-sm">
              {threads.error.message}
            </Txt>
          ) : null}
          {empty ? (
            <Txt tone="muted" className="mt-8 text-center text-base">
              {query.trim() ? "No chats match that." : "No chats yet. Ask something and it shows up here."}
            </Txt>
          ) : null}
          {groups.map(({ group, items }) => (
            <View key={group} className="mt-4">
              <Txt weight="medium" tone="faint" className="mb-1 px-3 text-xs uppercase" style={{ letterSpacing: 0.6 }}>
                {group}
              </Txt>
              {items.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => {
                    setQuery("");
                    onOpen(t.id);
                  }}
                  onLongPress={() => confirmDelete(t)}
                  accessibilityRole="button"
                  accessibilityHint="Long-press to delete"
                  accessibilityState={{ selected: t.id === currentId }}
                  className={`rounded-2xl px-3 py-2.5 ${t.id === currentId ? "bg-surface" : "active:bg-surface"}`}
                >
                  <View className="flex-row items-baseline gap-3">
                    <Txt weight="medium" className="flex-1 text-base" numberOfLines={1}>
                      {t.title}
                    </Txt>
                    <Txt tone="faint" className="text-xs">
                      {whenLabel(t.updated_at, group)}
                    </Txt>
                  </View>
                  {t.preview ? (
                    <Txt tone="muted" className="mt-0.5 text-sm" numberOfLines={1}>
                      {t.preview}
                    </Txt>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>

        <Txt tone="faint" className="mt-2 text-center text-xs">
          Chats are kept for {keepDays} days. Long-press one to delete it.
        </Txt>
      </View>
    </Sheet>
  );
}
