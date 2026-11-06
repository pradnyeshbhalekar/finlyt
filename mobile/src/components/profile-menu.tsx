// Your photo in Home's header, and the menu it opens: Ask Finlyt, Plan, History, Owed and
// Settings, in a bottom sheet within thumb reach. This replaces the row of header icons.
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import { HandCoins, History, Settings, Target } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AskIcon } from "@/components/ask-icon";
import { Divider, Icon, Row, Sheet, Txt, type IconType } from "@/components/ui";
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
    <View
      className="items-center justify-center rounded-full bg-brand"
      style={{ width: size, height: size }}
    >
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
      accessibilityLabel="Menu"
      hitSlop={6}
      className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
    >
      <Avatar user={user} size={34} />
    </Pressable>
  );
}

type Item = { icon: IconType; title: string; subtitle: string; href: Href };

export function ProfileMenu({
  visible,
  onClose,
  user,
  planNote,
  owedNote,
}: {
  visible: boolean;
  onClose: () => void;
  user: User | null;
  /** e.g. "₹410 left today"; a generic line is shown without a plan. */
  planNote?: string | null;
  /** e.g. "₹200 owed to you · you owe ₹80". */
  owedNote?: string | null;
}) {
  const items: Item[] = [
    { icon: AskIcon, title: "Ask Finlyt", subtitle: "Questions about your money", href: "/ask" },
    { icon: Target, title: "Plan", subtitle: planNote || "Budget, daily limit, Sunday check-in", href: "/plan" },
    { icon: History, title: "History", subtitle: "Everything you've logged", href: "/history" },
    { icon: HandCoins, title: "Owed", subtitle: owedNote || "Who owes you, and whom you owe", href: "/owed" },
    { icon: Settings, title: "Settings", subtitle: "Reminders, theme, bank SMS, widgets", href: "/settings" },
  ];

  function go(href: Href) {
    onClose();
    router.push(href);
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="flex-row items-center gap-3 px-1">
        <Avatar user={user} size={44} />
        <View className="flex-1">
          <Txt weight="semibold" className="text-lg" numberOfLines={1}>
            {user?.name ?? "Signed in"}
          </Txt>
          {user?.email ? (
            <Txt tone="muted" className="text-sm" numberOfLines={1}>
              {user.email}
            </Txt>
          ) : null}
        </View>
      </View>
      <Divider className="my-3" />
      <View className="-mx-2">
        {items.map((item) => (
          <Row
            key={item.title}
            onPress={() => go(item.href)}
            leading={
              <View className="h-10 w-10 items-center justify-center rounded-full bg-surface">
                <Icon icon={item.icon} size={20} />
              </View>
            }
            title={item.title}
            subtitle={item.subtitle}
          />
        ))}
      </View>
    </Sheet>
  );
}
