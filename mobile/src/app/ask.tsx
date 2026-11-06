// Ask Finlyt: questions about your money, answered from your own data. Opened from Home's header,
// or straight from the Home box when what you typed is a question (passed in as `q`, which starts
// a new chat). Chats are saved on the server for 10 days; the header's history icon lists them.
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams } from "expo-router";
import { ArrowUp, History, Mic, Square, SquarePen } from "lucide-react-native";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, TextInput, ToastAndroid, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { AskHistory } from "@/components/ask-history";
import { Coin } from "@/components/brand";
import { KeyboardAware } from "@/components/keyboard";
import { IconButton, Txt } from "@/components/ui";
import { fetchAskThread, useAsk, useMeta } from "@/lib/queries";
import { useDictation } from "@/lib/speech";
import { BRAND, fonts, useTheme, WHITE } from "@/lib/theme";

type Message = { role: "user" | "finlyt"; text: string; tools_used?: string[] };

// What each data tool reads, for the "Looked at" line under an answer.
const LOOKED_AT: Record<string, string> = {
  spending_summary: "spending",
  find_expenses: "expenses",
  people_balances: "people",
  budget_status: "budget",
  bank_payments: "bank payments",
  recent_activity: "activity",
  categories_and_accounts: "categories",
};

function lookedAt(tools: string[] | undefined): string | null {
  const labels = [...new Set((tools ?? []).map((t) => LOOKED_AT[t] ?? t.replace(/_/g, " ")))];
  return labels.length ? `Looked at: ${labels.join(", ")}` : null;
}

async function copy(text: string) {
  await Clipboard.setStringAsync(text);
  // Android 13 and later show their own "Copied" confirmation.
  if (Platform.OS === "android" && Number(Platform.Version) < 33) ToastAndroid.show("Copied", ToastAndroid.SHORT);
}

const SUGGESTIONS = [
  "Where did my money go this week?",
  "How much on food this month?",
  "Who owes me money?",
  "Kal kitna kharcha hua?",
  "What were my biggest spends in October?",
];

export default function Ask() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  const { colors } = useTheme();
  const meta = useMeta();
  const ask = useAsk();
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const started = useRef(false);
  const dictation = useDictation(setInput, setError);
  const hints = [
    ...(meta.data?.categories ?? []).map((c) => c.name),
    ...(meta.data?.people ?? []).map((p) => p.name),
    "kitna", "kharcha", "this week", "last month",
  ];

  async function send(text: string) {
    const question = text.trim();
    if (!question || ask.isPending) return;
    const next: Message[] = [...messages, { role: "user", text: question }];
    setMessages(next);
    setInput("");
    setError(null);
    try {
      const turn = await ask.mutateAsync({ text: question, threadId });
      setThreadId(turn.thread_id ?? null);
      setMessages([...next, { role: "finlyt", text: turn.reply, tools_used: turn.tools_used }]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function newChat() {
    setHistoryOpen(false);
    setMessages([]);
    setThreadId(null);
    setError(null);
  }

  async function openChat(id: number) {
    setHistoryOpen(false);
    if (id === threadId) return;
    setOpening(true);
    setError(null);
    try {
      const thread = await fetchAskThread(id);
      setMessages(thread.messages.map((m) => ({ role: m.role, text: m.text, tools_used: m.tools_used })));
      setThreadId(thread.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(false);
    }
  }

  // A question typed on Home arrives as `q`: ask it straight away.
  useEffect(() => {
    if (!q || started.current) return;
    started.current = true;
    void send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function toggleMic() {
    if (dictation.listening) {
      dictation.stop();
      return;
    }
    if (!(await dictation.start(input, hints))) setError("Voice input isn't available on this phone.");
  }

  const canSend = input.trim().length > 0 && !ask.isPending && !opening && !dictation.listening;
  // Switching chats while an answer is on its way would drop it into the wrong one.
  const busy = ask.isPending || opening;

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          headerRight: () => (
            <View className="-mr-2 flex-row">
              {messages.length > 0 ? (
                <IconButton icon={SquarePen} label="New chat" onPress={newChat} disabled={busy} />
              ) : null}
              <IconButton icon={History} label="Past chats" onPress={() => setHistoryOpen(true)} disabled={busy} />
            </View>
          ),
        }}
      />
      <AskHistory
        visible={historyOpen}
        currentId={threadId}
        onClose={() => setHistoryOpen(false)}
        onOpen={(id) => void openChat(id)}
        onNew={newChat}
        onDeleted={(id) => {
          if (id === threadId) newChat();
        }}
      />
      <ScrollView
        ref={scroll}
        className="flex-1"
        contentContainerClassName="px-4 pb-4 pt-2"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
      >
        {opening ? (
          <View className="mt-16 items-center">
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : null}
        {messages.length === 0 && !ask.isPending && !opening ? (
          <View className="mt-6 px-2">
            <Animated.View entering={FadeInDown.duration(400)}>
              <Coin size={56} variant="bare" />
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(90).duration(400)}>
              <Txt weight="bold" className="mt-6 text-3xl" style={{ letterSpacing: -0.5 }}>
                Ask about your money
              </Txt>
              <Txt tone="muted" className="mt-2 text-base leading-6">
                Anything, any day. Finlyt looks it up in what you&apos;ve logged.
              </Txt>
            </Animated.View>
            <View className="mt-6 gap-2">
              {SUGGESTIONS.map((s, i) => (
                <Animated.View key={s} entering={FadeInDown.delay(180 + i * 70).duration(380)}>
                  <Pressable
                    onPress={() => void send(s)}
                    className="self-start rounded-full border border-line px-4 py-2.5 active:bg-surface"
                  >
                    <Txt className="text-sm">{s}</Txt>
                  </Pressable>
                </Animated.View>
              ))}
            </View>
          </View>
        ) : null}

        {messages.map((m, i) => {
          if (m.role === "user") {
            return (
              <Pressable
                key={i}
                onLongPress={() => void copy(m.text)}
                accessibilityHint="Long-press to copy"
                className="mb-3 self-end rounded-3xl rounded-br-md px-4 py-3"
                style={{ backgroundColor: BRAND, maxWidth: "82%" }}
              >
                <Txt tone="onBrand" className="text-base" style={{ lineHeight: 23 }}>
                  {m.text}
                </Txt>
              </Pressable>
            );
          }
          const looked = lookedAt(m.tools_used);
          return (
            <View key={i} className="mb-3">
              <View className="flex-row items-end gap-2 pr-8">
                <Coin size={28} variant="bare" />
                <Pressable
                  onLongPress={() => void copy(m.text)}
                  accessibilityHint="Long-press to copy"
                  className="rounded-3xl rounded-bl-md bg-surface px-4 py-3"
                >
                  <Txt className="text-base" style={{ lineHeight: 23 }}>
                    {m.text}
                  </Txt>
                </Pressable>
              </View>
              {looked ? (
                <Txt tone="faint" className="ml-9 mt-1 text-xs">
                  {looked}
                </Txt>
              ) : null}
            </View>
          );
        })}
        {ask.isPending ? (
          <View className="mb-3 flex-row items-end gap-2">
            <Coin size={28} variant="bare" mood="thinking" />
            <View className="rounded-3xl rounded-bl-md bg-surface px-4 py-3">
              <ActivityIndicator color={colors.muted} />
            </View>
          </View>
        ) : null}
        {error ? (
          <Txt tone="danger" className="ml-9 mt-1 text-sm">
            {error}
          </Txt>
        ) : null}
      </ScrollView>

      <KeyboardAware>
        <View className="mx-4 mt-2 flex-row items-end rounded-[28px] bg-surface p-1.5">
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={dictation.listening ? "Listening…" : "Ask anything about your money"}
            placeholderTextColor={colors.faint}
            multiline
            editable={!dictation.listening}
            className="max-h-32 min-h-11 flex-1 px-3 py-2.5 text-base text-fg"
            style={{ fontFamily: fonts.regular }}
          />
          <IconButton
            icon={dictation.listening ? Square : Mic}
            label={dictation.listening ? "Stop" : "Talk"}
            onPress={() => void toggleMic()}
            tone={dictation.listening ? "danger" : "muted"}
          />
          <Pressable
            onPress={() => void send(input)}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Ask"
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: BRAND, opacity: canSend ? 1 : 0.3 }}
          >
            <ArrowUp size={22} color={WHITE} strokeWidth={2} />
          </Pressable>
        </View>
      </KeyboardAware>
    </View>
  );
}
