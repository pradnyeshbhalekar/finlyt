import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  useColorScheme,
  View,
  type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "@/lib/theme";

export function Screen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-white dark:bg-black" style={{ paddingTop: insets.top }}>
      {children}
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text className="text-2xl font-bold text-ink dark:text-white">{children}</Text>;
}

export function Muted({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Text className={`text-sm text-zinc-500 dark:text-zinc-400 ${className}`}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <Text className="mb-2 mt-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">{children}</Text>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <View className={`rounded-2xl bg-primary-50 p-4 dark:bg-zinc-900 ${className}`}>{children}</View>
  );
}

// Primary = brand blue. Secondary = ink (flips to white in dark mode so it stays visible).
const BUTTON_STYLES = {
  primary: { box: "bg-primary active:bg-primary-700", text: "text-white" },
  secondary: {
    box: "bg-secondary active:bg-zinc-800 dark:bg-white dark:active:bg-zinc-200",
    text: "text-white dark:text-ink",
  },
  danger: { box: "bg-red-600 active:bg-red-700", text: "text-white" },
} as const;

export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: keyof typeof BUTTON_STYLES;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  const style = BUTTON_STYLES[variant];
  const dark = useColorScheme() === "dark";
  const spinner = variant === "secondary" && dark ? colors.ink : colors.white;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      className={`flex-row items-center justify-center rounded-xl px-4 py-3 ${style.box} ${
        disabled ? "opacity-50" : ""
      }`}
    >
      {loading ? (
        <ActivityIndicator color={spinner} />
      ) : (
        <>
          {icon}
          <Text className={`text-base font-semibold ${style.text} ${icon ? "ml-2" : ""}`}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`mb-2 mr-2 rounded-full border px-3 py-1.5 ${
        selected
          ? "border-primary bg-primary"
          : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"
      }`}
    >
      <Text className={selected ? "text-white" : "text-zinc-700 dark:text-zinc-200"}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, className = "", ...props }: TextInputProps & { label?: string }) {
  return (
    <View className={`mb-3 ${className}`}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        className="rounded-xl border border-zinc-300 bg-white px-3 py-3 text-base text-ink dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        {...props}
      />
    </View>
  );
}

/** Floating "+" that opens the add-expense sheet. */
export function AddButton() {
  return (
    <Pressable
      onPress={() => router.push("/expense/new")}
      accessibilityLabel="Add expense"
      className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg active:bg-primary-700"
    >
      <Ionicons name="add" size={30} color={colors.white} />
    </Pressable>
  );
}
