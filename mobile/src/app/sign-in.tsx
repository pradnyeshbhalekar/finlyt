// Sign in: the logo, the coin in its rings with a few entries floating around it, the promise in
// one line, and one button. Laid out like the hero on finlyt.onrender.com.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Bell, MessageSquareText, Target, type LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, useWindowDimensions, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderLogo } from "@/components/brand";
import { CoinHero } from "@/components/hero-art";
import { Icon, Screen, Txt } from "@/components/ui";
import { describeSignInError, useAuth } from "@/lib/auth";
import { missingConfig } from "@/lib/config";
import { useTheme } from "@/lib/theme";

const appear = (i: number) => FadeInDown.delay(110 * i + 80).duration(520);

const POINTS: { icon: LucideIcon; text: string }[] = [
  { icon: MessageSquareText, text: "Plain words" },
  { icon: Bell, text: "Reminders" },
  { icon: Target, text: "Daily limit" },
];

export default function SignIn() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { colors } = useTheme();
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = missingConfig();

  async function onPress() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      setError(describeSignInError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View className="px-6 pt-4">
        <HeaderLogo height={28} splashTarget />
      </View>

      <View className="flex-1 justify-center px-4">
        <Animated.View entering={appear(0)}>
          <CoinHero size={Math.min(height * 0.36, 320)} />
        </Animated.View>
      </View>

      <View className="px-6">
        <Animated.View entering={appear(1)}>
          <Txt weight="bold" style={{ fontSize: 40, letterSpacing: -1.4, lineHeight: 44 }}>
            Never forget an expense again.
          </Txt>
        </Animated.View>
        <Animated.View entering={appear(2)}>
          <Txt tone="muted" className="mt-3 text-base" style={{ lineHeight: 24 }}>
            Type or say what you spent, the way you&apos;d tell a friend. Finlyt sorts it out and keeps your month on
            track.
          </Txt>
        </Animated.View>
        <Animated.View entering={appear(3)} className="mt-5 flex-row flex-wrap gap-2">
          {POINTS.map((p) => (
            <View key={p.text} className="flex-row items-center gap-1.5 rounded-full border border-line px-3 py-1.5">
              <Icon icon={p.icon} size={14} tone="accent" />
              <Txt weight="medium" className="text-sm">
                {p.text}
              </Txt>
            </View>
          ))}
        </Animated.View>
      </View>

      <Animated.View entering={appear(4)}>
        <View className="px-6 pt-7" style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}>
          {missing.length > 0 ? (
            <Txt tone="warn" className="mb-3 text-sm">
              Set {missing.join(" and ")} in mobile/.env, then restart the dev server.
            </Txt>
          ) : null}
          {error ? (
            <Txt tone="danger" className="mb-3 text-sm">
              {error}
            </Txt>
          ) : null}
          {/* A light pill on dark grounds and a dark pill on light, like the site's main button. */}
          <Pressable
            onPress={() => void onPress()}
            disabled={busy || missing.length > 0}
            accessibilityRole="button"
            className={`h-14 flex-row items-center justify-center gap-3 rounded-full bg-fg active:opacity-80 ${
              missing.length > 0 ? "opacity-40" : ""
            }`}
          >
            {busy ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color={colors.bg} />
                <Txt weight="semibold" tone="inverse" className="text-base">
                  Continue with Google
                </Txt>
              </>
            )}
          </Pressable>
          <Txt tone="faint" className="mt-3 text-center text-xs">
            Free, and your entries are saved to your account.
          </Txt>
        </View>
      </Animated.View>
    </Screen>
  );
}
