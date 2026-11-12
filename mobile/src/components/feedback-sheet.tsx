// Send feedback (Settings → Send feedback): pick what kind, say it, send. It's emailed to whoever
// runs Finlyt with your address to reply to, along with the app version and phone model.
import Constants from "expo-constants";
import { Check, Heart, Lightbulb, TriangleAlert, type LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { Platform, Pressable, TextInput, View } from "react-native";

import { Coin } from "@/components/brand";
import { useSendFeedback } from "@/lib/queries";
import { BRAND, fonts, useTheme } from "@/lib/theme";
import type { FeedbackKind } from "@/lib/types";

import { Button, Icon, Sheet, Txt } from "./ui";

const KINDS: { value: FeedbackKind; label: string; icon: LucideIcon; placeholder: string }[] = [
  { value: "idea", label: "Idea", icon: Lightbulb, placeholder: "What would make Finlyt better for you?" },
  { value: "problem", label: "Problem", icon: TriangleAlert, placeholder: "What went wrong, and what were you doing?" },
  { value: "praise", label: "I like…", icon: Heart, placeholder: "What do you like about Finlyt?" },
];

/** "Pixel 10a · Android 16", from what React Native knows about the phone. */
function deviceLabel(): string {
  const c = Platform.constants as { Model?: string; Brand?: string; Release?: string };
  const model = c.Model ?? "";
  const android = c.Release ? `Android ${c.Release}` : `API ${Platform.Version}`;
  return [model, android].filter(Boolean).join(" · ").slice(0, 80);
}

export function FeedbackSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const send = useSendFeedback();
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const placeholder = KINDS.find((k) => k.value === kind)!.placeholder;

  function close() {
    onClose();
    // Start fresh next time, once the sheet has gone.
    setTimeout(() => {
      setSent(false);
      setMessage("");
      setKind("idea");
      setError(null);
    }, 300);
  }

  async function submit() {
    setError(null);
    try {
      await send.mutateAsync({
        kind,
        message: message.trim(),
        app_version: Constants.expoConfig?.version ?? null,
        device: deviceLabel(),
      });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Sheet visible={visible} onClose={close}>
      {sent ? (
        <View className="items-center pb-2 pt-2">
          <Coin size={64} variant="bare" mood="happy" />
          <Txt weight="semibold" className="mt-4 text-xl">
            Thank you!
          </Txt>
          <Txt tone="muted" className="mt-1.5 text-center text-base" style={{ lineHeight: 22 }}>
            It&apos;s on its way. If it needs an answer, the reply comes to your email.
          </Txt>
          <Button label="Done" onPress={close} className="mt-6 self-stretch" />
        </View>
      ) : (
        <>
          <Txt weight="semibold" className="text-lg">
            Send feedback
          </Txt>
          <Txt tone="muted" className="mt-1 text-sm">
            Ideas, problems, or something you like. Every message is read.
          </Txt>
          <View className="mt-4 flex-row gap-2">
            {KINDS.map((k) => {
              const on = k.value === kind;
              return (
                <Pressable
                  key={k.value}
                  onPress={() => setKind(k.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-full py-2.5 ${on ? "bg-accent-soft" : "bg-surface"}`}
                  style={{ borderWidth: 1.5, borderColor: on ? BRAND : "transparent" }}
                >
                  <Icon icon={k.icon} size={15} tone={on ? "accent" : "muted"} />
                  <Txt weight="medium" tone={on ? "accent" : "fg"} className="text-sm">
                    {k.label}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={placeholder}
            placeholderTextColor={colors.faint}
            multiline
            maxLength={4000}
            textAlignVertical="top"
            autoFocus
            className="mt-3 h-32 rounded-2xl bg-surface p-3.5 text-base text-fg"
            style={{ fontFamily: fonts.regular }}
          />
          {error ? (
            <Txt tone="danger" className="mt-2 text-sm">
              {error}
            </Txt>
          ) : null}
          <Button
            label="Send"
            icon={Check}
            onPress={() => void submit()}
            loading={send.isPending}
            disabled={message.trim().length < 2}
            className="mt-4"
          />
        </>
      )}
    </Sheet>
  );
}
