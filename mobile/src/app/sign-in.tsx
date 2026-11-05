// Sign in, laid out like the hero on finlyt.onrender.com.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderLogo } from "@/components/brand";
import { Screen, Txt } from "@/components/ui";
import { describeSignInError, useAuth } from "@/lib/auth";
import { missingConfig } from "@/lib/config";
import { useTheme } from "@/lib/theme";

const appear = (i: number) => FadeInDown.delay(120 * i + 80).duration(500);

export default function SignIn() {
  const insets = useSafeAreaInsets();
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
        <HeaderLogo height={30} splashTarget />
      </View>
      <View className="flex-1 justify-center px-6 pb-10">
        <Animated.View entering={appear(0)}>
          <Txt tone="muted" className="text-sm">
            Expense tracker for Android
          </Txt>
        </Animated.View>
        <Animated.View entering={appear(1)}>
          <Txt weight="bold" className="mt-3 text-5xl" style={{ letterSpacing: -1.5, lineHeight: 54 }}>
            Never forget an expense again.
          </Txt>
        </Animated.View>
        <Animated.View entering={appear(2)}>
          <Txt tone="muted" className="mt-4 text-lg" style={{ lineHeight: 27 }}>
            Finlyt reminds you at the times you pick and lets you log what you spent in plain words.
          </Txt>
        </Animated.View>
      </View>

      <Animated.View entering={appear(3)}>
        <View className="px-6" style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}>
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
        </View>
      </Animated.View>
    </Screen>
  );
}
