import "../global.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { useColorScheme } from "react-native";

import { AuthProvider, useAuth } from "@/lib/auth";
import { scheduleReminders, useNotificationRedirect } from "@/lib/notifications";
import { colors } from "@/lib/theme";

void SplashScreen.preventAutoHideAsync();

// Headers, tab bar and screen backgrounds: brand blue on white, or on black in dark mode.
const lightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.white,
    card: colors.white,
    text: colors.ink,
    border: colors.border,
  },
};
const darkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primaryOnDark,
    background: colors.black,
    card: colors.black,
    text: colors.white,
    border: colors.borderDark,
  },
};

export default function RootLayout() {
  const scheme = useColorScheme();
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }),
  );
  return (
    <ThemeProvider value={scheme === "dark" ? darkTheme : lightTheme}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="auto" />
          <RootNavigator />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { status } = useAuth();
  const signedIn = status === "signed-in";

  // The splash screen stays up until we know whether a saved session exists.
  useEffect(() => {
    if (status !== "loading") void SplashScreen.hideAsync();
  }, [status]);

  // Re-schedule on every launch so reminders survive app updates, reboots and clock changes.
  useEffect(() => {
    if (signedIn) void scheduleReminders();
  }, [signedIn]);

  useNotificationRedirect(signedIn);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="expense/new"
          options={{ presentation: "modal", headerShown: true, title: "Add expense" }}
        />
        <Stack.Screen name="log/review" options={{ headerShown: true, title: "Review" }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
