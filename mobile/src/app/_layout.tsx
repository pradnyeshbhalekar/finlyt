import "../global.css";

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useState, type ReactNode } from "react";
import { useColorScheme, View } from "react-native";

import { AuthProvider, useAuth } from "@/lib/auth";
import { scheduleReminders, useNotificationRedirect } from "@/lib/notifications";
import { PrefsProvider, usePrefs } from "@/lib/prefs";
import { fonts, resolveTheme, ThemeContext, themeVars } from "@/lib/theme";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }),
  );
  return (
    <PrefsProvider>
      <Themed>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RootNavigator fontsLoaded={fontsLoaded} />
          </AuthProvider>
        </QueryClientProvider>
      </Themed>
    </PrefsProvider>
  );
}

/** Applies the chosen theme (Light, Dark or Ink) to Tailwind classes, navigation and system bars. */
function Themed({ children }: { children: ReactNode }) {
  const { theme: mode } = usePrefs();
  const system = useColorScheme();
  const theme = resolveTheme(mode, system);
  const { colors } = theme;

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bg);
  }, [colors.bg]);

  const base = theme.isDark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.bg,
      card: colors.bg,
      text: colors.fg,
      border: colors.line,
    },
  };

  return (
    <ThemeContext.Provider value={theme}>
      <ThemeProvider value={navigationTheme}>
        <View style={[{ flex: 1, backgroundColor: colors.bg }, themeVars(colors)]}>
          <StatusBar style={theme.isDark ? "light" : "dark"} />
          {children}
        </View>
      </ThemeProvider>
    </ThemeContext.Provider>
  );
}

function RootNavigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { status } = useAuth();
  const prefs = usePrefs();
  const signedIn = status === "signed-in";
  const ready = fontsLoaded && prefs.loaded && status !== "loading";

  // The splash screen stays up until fonts, preferences and the saved session are known.
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // Re-schedule on every launch so reminders survive app updates, reboots and clock changes.
  useEffect(() => {
    if (signedIn && prefs.onboarded) void scheduleReminders();
  }, [signedIn, prefs.onboarded]);

  useNotificationRedirect(signedIn && prefs.onboarded);

  // Text laid out before Inter loads keeps the fallback font's width on Android and gets clipped
  // ("Continu"), so nothing renders until the fonts are in. The splash covers the wait.
  if (!fontsLoaded) return null;

  const header = {
    headerShown: true,
    headerShadowVisible: false,
    headerTitleStyle: { fontFamily: fonts.semibold },
  } as const;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn && prefs.onboarded}>
        <Stack.Screen name="index" />
        <Stack.Screen name="history" options={{ ...header, title: "History" }} />
        <Stack.Screen name="owed" options={{ ...header, title: "Owed to you" }} />
        <Stack.Screen name="settings" options={{ ...header, title: "Settings" }} />
        <Stack.Screen name="plan" options={{ ...header, title: "Check-in" }} />
        <Stack.Screen name="log/review" options={{ ...header, title: "Check entries" }} />
        <Stack.Screen
          name="expense/new"
          options={{ ...header, presentation: "modal", title: "Add by hand" }}
        />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !prefs.onboarded}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
