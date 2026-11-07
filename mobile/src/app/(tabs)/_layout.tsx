// Home, Ask, Plan and History, switched from the bottom bar. Everything else (Settings, Owed, an
// entry, the check-in chat, Review) opens on top of these from the root stack, without the bar.
import { Tabs } from "expo-router/js-tabs";

import { TabBar } from "@/components/tab-bar";
import { HeaderAvatar, TabLogo } from "@/components/tab-header";
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
        // The logo on every tab, like Home; the tab bar says which one you're on.
        headerTitle: () => <TabLogo />,
        headerTitleAlign: "left",
        headerRight: () => <HeaderAvatar />,
        headerRightContainerStyle: { paddingRight: 12 },
        headerLeftContainerStyle: { paddingLeft: 8 },
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
