// Small, theme-aware building blocks. Colours come from the active theme (Light, Dark or Ink),
// type is Inter, and icons are Lucide. No emojis anywhere in the UI.
import type { LucideIcon } from "lucide-react-native";
import type { ComponentType, ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BRAND, fonts, useTheme, WHITE } from "@/lib/theme";

type Weight = keyof typeof fonts;
type Tone = "fg" | "muted" | "faint" | "accent" | "danger" | "onBrand" | "warn" | "inverse";

const TONE_CLASS: Record<Tone, string> = {
  fg: "text-fg",
  muted: "text-muted",
  faint: "text-faint",
  accent: "text-accent",
  danger: "text-danger",
  onBrand: "text-white",
  warn: "text-warn-fg",
  inverse: "text-bg",
};

/** All text goes through here so the font and colour follow the theme. */
export function Txt({
  weight = "regular",
  tone = "fg",
  className = "",
  style,
  ...props
}: TextProps & { weight?: Weight; tone?: Tone; className?: string }) {
  return (
    <Text
      className={`${TONE_CLASS[tone]} ${className}`}
      style={[{ fontFamily: fonts[weight] }, style as StyleProp<TextStyle>]}
      {...props}
    />
  );
}

export function Screen({ children, edges = true }: { children: ReactNode; edges?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-bg" style={edges ? { paddingTop: insets.top } : undefined}>
      {children}
    </View>
  );
}

/** Small uppercase label above a group, like "TODAY". */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <Txt weight="medium" tone="muted" className={`text-xs uppercase tracking-widest ${className}`}>
      {children}
    </Txt>
  );
}

/** A Lucide icon, or one of ours drawn the same way (size, color, strokeWidth). */
export type IconType = LucideIcon | ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

export function Icon({
  icon: IconComponent,
  size = 20,
  color,
  tone = "fg",
}: {
  icon: IconType;
  size?: number;
  color?: string;
  tone?: "fg" | "muted" | "accent" | "danger" | "faint";
}) {
  const { colors } = useTheme();
  return <IconComponent size={size} color={color ?? colors[tone]} strokeWidth={1.75} />;
}

export function IconButton({
  icon,
  label,
  onPress,
  tone = "fg",
  disabled = false,
}: {
  icon: IconType;
  label: string;
  onPress: () => void;
  tone?: "fg" | "muted" | "accent" | "danger";
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      className={`h-11 w-11 items-center justify-center rounded-full active:bg-surface ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <Icon icon={icon} size={22} tone={tone} />
    </Pressable>
  );
}

const BUTTON = {
  primary: { box: "bg-brand active:opacity-80", tone: "onBrand" as Tone },
  secondary: { box: "bg-surface active:opacity-70", tone: "fg" as Tone },
  ghost: { box: "active:bg-surface", tone: "muted" as Tone },
  danger: { box: "active:bg-surface", tone: "danger" as Tone },
};

export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  icon,
  className = "",
}: {
  label: string;
  onPress: () => void;
  variant?: keyof typeof BUTTON;
  loading?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  className?: string;
}) {
  const style = BUTTON[variant];
  const { colors } = useTheme();
  const iconColor = variant === "primary" ? WHITE : variant === "danger" ? colors.danger : colors.fg;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      className={`h-12 flex-row items-center justify-center gap-2 rounded-full px-5 ${style.box} ${
        disabled ? "opacity-40" : ""
      } ${className}`}
    >
      {loading ? (
        <ActivityIndicator color={iconColor} />
      ) : (
        <>
          {icon ? <Icon icon={icon} size={18} color={iconColor} /> : null}
          <Txt weight="semibold" tone={style.tone} className="text-base">
            {label}
          </Txt>
        </>
      )}
    </Pressable>
  );
}

/** A tappable list row: optional leading element, title + subtitle, trailing value. */
export function Row({
  leading,
  title,
  subtitle,
  trailing,
  onPress,
  onLongPress,
  className = "",
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  className?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      className={`min-h-14 flex-row items-center gap-3 rounded-2xl px-3 py-3 active:bg-surface ${className}`}
    >
      {leading}
      <View className="flex-1">
        {typeof title === "string" ? (
          <Txt weight="medium" className="text-base" numberOfLines={1}>
            {title}
          </Txt>
        ) : (
          title
        )}
        {typeof subtitle === "string" ? (
          <Txt tone="muted" className="mt-0.5 text-sm" numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : (
          subtitle
        )}
      </View>
      {trailing}
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="flex-row rounded-full bg-surface p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            className={`h-10 flex-1 items-center justify-center rounded-full ${selected ? "bg-bg" : ""}`}
          >
            <Txt weight={selected ? "semibold" : "medium"} tone={selected ? "fg" : "muted"} className="text-sm">
              {option.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const { colors } = useTheme();
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      accessibilityLabel={label}
      trackColor={{ true: BRAND, false: colors.line }}
      thumbColor={WHITE}
    />
  );
}

export function SwitchRow({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable onPress={() => onChange(!value)} className="flex-row items-center gap-4 py-3">
      <View className="flex-1">
        <Txt weight="medium" className="text-base">
          {title}
        </Txt>
        {description ? (
          <Txt tone="muted" className="mt-1 text-sm leading-5">
            {description}
          </Txt>
        ) : null}
      </View>
      <Toggle value={value} onChange={onChange} label={title} />
    </Pressable>
  );
}

export function Field({
  label,
  className = "",
  style,
  ...props
}: TextInputProps & { label?: string; className?: string }) {
  const { colors } = useTheme();
  return (
    <View className={`mb-3 ${className}`}>
      {label ? (
        <Txt weight="medium" tone="muted" className="mb-2 text-sm">
          {label}
        </Txt>
      ) : null}
      <TextInput
        placeholderTextColor={colors.faint}
        className="h-12 rounded-2xl bg-surface px-4 text-base text-fg"
        style={[{ fontFamily: fonts.regular }, style]}
        {...props}
      />
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: LucideIcon;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`mb-2 mr-2 h-9 flex-row items-center gap-1.5 rounded-full px-3 ${
        selected ? "bg-brand" : "bg-surface"
      }`}
    >
      {icon ? <Icon icon={icon} size={15} color={selected ? WHITE : undefined} tone="muted" /> : null}
      <Txt weight="medium" tone={selected ? "onBrand" : "fg"} className="text-sm">
        {label}
      </Txt>
    </Pressable>
  );
}

/** A bottom sheet over a dimmed backdrop. Tapping the backdrop closes it. */
export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable className="flex-1 bg-black/50" onPress={onClose} accessibilityLabel="Close" />
      <View className="rounded-t-3xl bg-bg px-5 pt-5" style={{ paddingBottom: insets.bottom + 16 }}>
        {children}
      </View>
    </Modal>
  );
}

export function Divider({ className = "" }: { className?: string }) {
  return <View className={`h-px bg-line ${className}`} />;
}
