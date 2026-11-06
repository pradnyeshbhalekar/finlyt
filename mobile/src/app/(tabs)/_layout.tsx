// Home, Ask, Plan and History, switched from the bottom bar. Everything else (Settings, Owed, an
// entry, the check-in chat, Review) opens on top of these from the root stack, without the bar.
import { Tabs } from "expo-router/js-tabs";

import { TabBar } from "@/components/tab-bar";
import { fonts, useTheme } from "@/lib/theme";

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.semibold },
        animation: "fade",
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ headerShown: false, title: "Home" }} />
      <Tabs.Screen name="ask" options={{ title: "Ask Finlyt" }} />
      <Tabs.Screen name="plan" options={{ title: "Plan" }} />
      <Tabs.Screen name="history" options={{ title: "History" }} />
    </Tabs>
  );
}
