// Finlyt's three themes, from the "Finlyt logo" canvas: Light (white ground), Dark (black) and
// Ink (the brand's navy #0B1033). Screens use semantic Tailwind colours (bg-bg, text-fg,
// text-muted…) backed by CSS variables, and `useTheme().colors` where raw values are needed.
import { vars } from "nativewind";
import { createContext, useContext } from "react";

export type ThemeName = "light" | "dark" | "ink";
/** What the user picked. "auto" follows the phone: Light or Dark. */
export type ThemeMode = "auto" | ThemeName;

export type Palette = {
  bg: string;
  surface: string;
  line: string;
  fg: string;
  muted: string;
  faint: string;
  accent: string;
  accentSoft: string;
  danger: string;
  warnBg: string;
  warnFg: string;
};

export const BRAND = "#3355FF";
export const BRAND_EDGE = "#2440E6";
export const TINT = "#AEBBFF";
export const INK = "#0B1033";
export const WHITE = "#FFFFFF";

export const palettes: Record<ThemeName, Palette> = {
  light: {
    bg: "#FFFFFF",
    surface: "#F2F2EF",
    line: "#E5E5E0",
    fg: "#0B1033",
    muted: "#626679",
    faint: "#9A9DAD",
    accent: "#3355FF",
    accentSoft: "#E9EDFF",
    danger: "#D92D20",
    warnBg: "#FFF4E0",
    warnFg: "#8A4B00",
  },
  dark: {
    bg: "#000000",
    surface: "#151515",
    line: "#262626",
    fg: "#FFFFFF",
    muted: "#A0A0A6",
    faint: "#6C6C72",
    accent: "#8197FF",
    accentSoft: "#141B3D",
    danger: "#FF6B5E",
    warnBg: "#2B1F0A",
    warnFg: "#F5C46B",
  },
  ink: {
    bg: "#0B1033",
    surface: "#161C48",
    line: "#252C60",
    fg: "#FFFFFF",
    muted: "#8C93C8",
    faint: "#5C6499",
    accent: "#AEBBFF",
    accentSoft: "#1C2468",
    danger: "#FF7A6E",
    warnBg: "#2A2440",
    warnFg: "#F5C46B",
  },
};

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** NativeWind CSS variables for a palette; put them on the root view. */
export function themeVars(p: Palette) {
  return vars({
    "--bg": rgb(p.bg),
    "--surface": rgb(p.surface),
    "--line": rgb(p.line),
    "--fg": rgb(p.fg),
    "--muted": rgb(p.muted),
    "--faint": rgb(p.faint),
    "--accent": rgb(p.accent),
    "--accent-soft": rgb(p.accentSoft),
    "--danger": rgb(p.danger),
    "--warn-bg": rgb(p.warnBg),
    "--warn-fg": rgb(p.warnFg),
  });
}

export type Theme = { name: ThemeName; colors: Palette; isDark: boolean };

export function resolveTheme(mode: ThemeMode, system: "light" | "dark" | null | undefined): Theme {
  const name: ThemeName = mode === "auto" ? (system === "dark" ? "dark" : "light") : mode;
  return { name, colors: palettes[name], isDark: name !== "light" };
}

export const ThemeContext = createContext<Theme>(resolveTheme("light", "light"));

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;
