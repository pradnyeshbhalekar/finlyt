import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, View, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Wordmark } from "@/components/brand";
import { Screen, Txt } from "@/components/ui";
import { describeSignInError, useAuth } from "@/lib/auth";
import { missingConfig } from "@/lib/config";
import { BRAND, WHITE } from "@/lib/theme";

export default function SignIn() {
  const insets = useSafeAreaInsets();
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
      <View className="flex-1 justify-center px-8">
        <Wordmark height={44} />
        <Txt weight="semibold" className="mt-10 text-3xl" style={{ letterSpacing: -0.5 }}>
          Never forget an expense.
        </Txt>
        <Txt tone="muted" className="mt-3 text-base leading-6">
          Finlyt reminds you when you choose and lets you log what you spent in plain words.
        </Txt>
      </View>

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
        <Pressable
          onPress={() => void onPress()}
          disabled={busy || missing.length > 0}
          accessibilityRole="button"
          className={`h-14 flex-row items-center justify-center gap-3 rounded-full active:opacity-80 ${
            missing.length > 0 ? "opacity-40" : ""
          }`}
          style={{ backgroundColor: BRAND }}
        >
          {busy ? (
            <ActivityIndicator color={WHITE} />
          ) : (
            <>
              <Ionicons name="logo-google" size={18} color={WHITE} />
              <Txt weight="semibold" tone="onBrand" className="text-base">
                Continue with Google
              </Txt>
            </>
          )}
        </Pressable>
      </View>
    </Screen>
  );
}
