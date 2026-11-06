// Your Google photo. In Home's header it opens Settings, which is your profile; the app's
// features (Ask, Plan, History) live in the bottom bar instead.
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { Txt } from "@/components/ui";
import type { User } from "@/lib/types";

/** The Google photo, or the first letter of your name on brand blue when there isn't one. */
export function Avatar({ user, size = 32 }: { user: User | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initial = (user?.name ?? user?.email ?? "?").trim().charAt(0).toUpperCase();
  if (user?.picture_url && !failed) {
    return (
      <Image
        source={{ uri: user.picture_url }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={150}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View className="items-center justify-center rounded-full bg-brand" style={{ width: size, height: size }}>
      <Txt weight="semibold" tone="onBrand" style={{ fontSize: size * 0.42 }}>
        {initial}
      </Txt>
    </View>
  );
}

export function AvatarButton({ user, onPress }: { user: User | null; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Profile and settings"
      hitSlop={6}
      className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
    >
      <Avatar user={user} size={34} />
    </Pressable>
  );
}
