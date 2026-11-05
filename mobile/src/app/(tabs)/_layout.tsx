import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { useColorScheme, type ColorValue } from "react-native";

import { colors } from "@/lib/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

function icon(name: IconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={typeof color === "string" ? color : undefined} size={size} />;
  };
}

export default function TabsLayout() {
  const dark = useColorScheme() === "dark";
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: dark ? colors.primaryOnDark : colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: dark ? colors.black : colors.white,
          borderTopColor: dark ? colors.borderDark : colors.border,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("home-outline") }} />
      <Tabs.Screen name="log" options={{ title: "Log", tabBarIcon: icon("mic-outline") }} />
      <Tabs.Screen name="history" options={{ title: "History", tabBarIcon: icon("list-outline") }} />
      <Tabs.Screen name="owed" options={{ title: "Owed", tabBarIcon: icon("people-outline") }} />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: icon("settings-outline") }}
      />
    </Tabs>
  );
}
