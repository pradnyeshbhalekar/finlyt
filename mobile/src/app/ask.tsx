// Ask Finlyt: questions about your money, answered from your own data. Opened from Home's header,
// or straight from the Home box when what you typed is a question (passed in as `q`).
import { useLocalSearchParams } from "expo-router";
import { ArrowUp, Mic, Square } from "lucide-react-native";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { Coin } from "@/components/brand";
import { KeyboardAware } from "@/components/keyboard";
import { IconButton, Txt } from "@/components/ui";
import { useAsk, useMeta } from "@/lib/queries";
import { useDictation } from "@/lib/speech";
import { BRAND, fonts, useTheme, WHITE } from "@/lib/theme";
import type { ChatMessage } from "@/lib/types";

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
    const next: ChatMessage[] = [...messages, { role: "user", text: question }];
    setMessages(next);
    setInput("");
    setError(null);
    try {
      const turn = await ask.mutateAsync(next);
      setMessages([...next, { role: "finlyt", text: turn.reply }]);
    } catch (e) {
      setError((e as Error).message);
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

  const canSend = input.trim().length > 0 && !ask.isPending && !dictation.listening;

  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        ref={scroll}
        className="flex-1"
        contentContainerClassName="px-4 pb-4 pt-2"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 && !ask.isPending ? (
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

        {messages.map((m, i) =>
          m.role === "finlyt" ? (
            <View key={i} className="mb-3 flex-row items-end gap-2 pr-8">
              <Coin size={28} variant="bare" />
              <View className="rounded-3xl rounded-bl-md bg-surface px-4 py-3">
                <Txt className="text-base" style={{ lineHeight: 23 }}>
                  {m.text}
                </Txt>
              </View>
            </View>
          ) : (
            <View
              key={i}
              className="mb-3 self-end rounded-3xl rounded-br-md px-4 py-3"
              style={{ backgroundColor: BRAND, maxWidth: "82%" }}
            >
              <Txt tone="onBrand" className="text-base" style={{ lineHeight: 23 }}>
                {m.text}
              </Txt>
            </View>
          ),
        )}
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
