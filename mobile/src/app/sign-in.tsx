import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Text, View } from "react-native";

import { Logo } from "@/components/brand";
import { Button, Muted, Screen } from "@/components/ui";
import { describeSignInError, useAuth } from "@/lib/auth";
import { missingConfig } from "@/lib/config";

export default function SignIn() {
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
        <Logo height={56} />
        <Muted className="mt-4 text-base">Know where every rupee went.</Muted>

        <View className="mt-12">
          <Button
            label="Continue with Google"
            onPress={onPress}
            loading={busy}
            disabled={missing.length > 0}
            icon={<Ionicons name="logo-google" size={18} color="#ffffff" />}
          />
        </View>

        {missing.length > 0 ? (
          <Text className="mt-4 text-sm text-amber-700 dark:text-amber-400">
            Set {missing.join(" and ")} in mobile/.env, then restart the dev server.
          </Text>
        ) : null}
        {error ? <Text className="mt-4 text-sm text-red-600">{error}</Text> : null}
      </View>
    </Screen>
  );
}
