// The bottom bar for Home, Ask, Plan and History. No pill (the user found it looked bad): the
// active tab's icon and label are Finlyt blue and slightly bolder, the rest grey. It's drawn here
// (not the library's default) to follow the themes and fonts.
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { History, House, Target } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AskIcon } from "@/components/ask-icon";
import { Txt, type IconType } from "@/components/ui";
import { useTheme } from "@/lib/theme";

const BAR_HEIGHT = 64;

const TABS: Record<string, { label: string; icon: IconType }> = {
  index: { label: "Home", icon: House },
  ask: { label: "Ask", icon: AskIcon },
  plan: { label: "Plan", icon: Target },
  history: { label: "History", icon: History },
};

/**
 * The bar's height including the gesture area. A tab's composer sits on top of the bar, and the
 * keyboard (edge to edge) covers both, so the composer only needs lifting by the difference.
 */
export function useTabBarHeight(): number {
  return BAR_HEIGHT + useSafeAreaInsets().bottom;
}

export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-row border-t border-line bg-bg"
      style={{ height: BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }}
    >
      {state.routes.map((route, index) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const focused = state.index === index;
        const TabIcon = tab.icon;
        function onPress() {
          const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        }
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
            className="flex-1 items-center justify-center gap-1"
          >
            <View className="h-8 items-center justify-center">
              <TabIcon size={24} color={focused ? colors.chart : colors.muted} strokeWidth={focused ? 2.1 : 1.75} />
            </View>
            <Txt weight={focused ? "semibold" : "medium"} tone={focused ? "accent" : "muted"} className="text-xs">
              {tab.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
